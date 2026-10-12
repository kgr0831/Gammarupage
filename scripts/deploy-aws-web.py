"""Dedicated AWS web deployment; default is a read-only plan.

uv run --no-project --with botocore --with python-dotenv python scripts/deploy-aws-web.py
--apply creates infrastructure only; --release installs the current clean commit.
No Vercel data is read, changed or imported. No secret values are printed.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile

import botocore.session
from botocore.exceptions import ClientError
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = "066523631431"
REGION = "ap-northeast-2"
BUCKET = f"gammaru-daily-scrum-{ACCOUNT}-seoul"
STACK = "gammaru-web"
VPC = "vpc-009dcb19c3a1e036c"
PARAMETER = "/gammaru/web/runtime"
AMI_PARAMETER = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"


def template():
    data = json.loads((ROOT / "infra/aws-web.json").read_text(encoding="utf-8"))
    bootstrap = (ROOT / "infra/aws-web-bootstrap.sh").read_text(encoding="utf-8")
    data["Resources"]["Web"]["Properties"]["UserData"] = {"Fn::Base64": bootstrap}
    return data


def runtime(origin):
    club = dotenv_values(ROOT / ".env.funding", interpolate=False)
    personal = dotenv_values(ROOT / ".env.personal", interpolate=False)
    if personal.get("DISCORD_APPLICATION_ID") != club.get("DISCORD_APPLICATION_ID") or personal.get("DISCORD_BOT_TOKEN") != club.get("DISCORD_BOT_TOKEN"):
        raise RuntimeError("Expected the shared Discord application in both local configurations")
    values = {
        "REPORTS_SITE_URL": origin, "REPORTS_SERVICE": "club",
        "REPORTS_TRUST_PROXY": "true",
        "REPORTS_STORAGE_BACKEND": "s3", "REPORTS_S3_BUCKET": BUCKET,
        "REPORTS_S3_REGION": REGION, "REPORTS_S3_ACCOUNT_ID": ACCOUNT,
        "AWS_REGION": REGION,
        "DISCORD_APPLICATION_ID": club.get("DISCORD_APPLICATION_ID"),
        "DISCORD_CLIENT_SECRET": club.get("DISCORD_CLIENT_SECRET") or personal.get("DISCORD_CLIENT_SECRET"),
        "DISCORD_BOT_TOKEN": club.get("DISCORD_BOT_TOKEN"),
        "DISCORD_DELIVERY_MODE": "worker", "DISCORD_DM_ENABLED": "false",
        "DISCORD_WORKER_TOKEN": club.get("DISCORD_WORKER_TOKEN"), "DISCORD_POLL_SECONDS": "60",
        "DISCORD_REPORT_CHANNEL_ID": "1556671666682069053",
        "PERSONAL_DISCORD_REPORT_CHANNEL_ID": "1556895044793925722",
        "FUNDING_ADMIN_USERNAME": club.get("FUNDING_ADMIN_USERNAME"),
        "FUNDING_ADMIN_TOKEN": club.get("FUNDING_ADMIN_TOKEN"),
        "FUNDING_PUBLISHER_TOKEN": club.get("FUNDING_PUBLISHER_TOKEN"),
        "PERSONAL_ADMIN_USERNAME": personal.get("FUNDING_ADMIN_USERNAME"),
        "PERSONAL_ADMIN_TOKEN": personal.get("FUNDING_ADMIN_TOKEN"),
        "PERSONAL_PUBLISHER_TOKEN": personal.get("FUNDING_PUBLISHER_TOKEN"),
    }
    if not re.fullmatch(r"https://[a-z0-9]+\.cloudfront\.net", origin):
        raise RuntimeError("Unexpected AWS site URL")
    if any(not isinstance(v, str) or not v or any(c in v for c in "\n\r\0") for v in values.values()):
        raise RuntimeError("Required local runtime settings are missing or invalid; no values logged")
    for key in ("FUNDING_ADMIN_TOKEN", "PERSONAL_ADMIN_TOKEN"):
        if len(values[key]) < 8:
            raise RuntimeError("Admin credential validation failed")
    keys = ("FUNDING_PUBLISHER_TOKEN", "PERSONAL_PUBLISHER_TOKEN", "DISCORD_WORKER_TOKEN")
    if any(len(values[k]) < 32 for k in keys) or len({values[k] for k in keys}) != len(keys):
        raise RuntimeError("Publisher/worker credentials must be distinct and at least 32 characters")
    for prefix in ("FUNDING", "PERSONAL"):
        if values[prefix + "_ADMIN_TOKEN"] == values[prefix + "_PUBLISHER_TOKEN"]:
            raise RuntimeError("Publisher and admin credentials must differ")
    return values


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=True).stdout


def archive():
    if git("status", "--porcelain").strip():
        raise RuntimeError("Commit the reviewed changes before deploying a release")
    revision = git("rev-parse", "HEAD").decode().strip()
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise RuntimeError("Invalid revision")
    prefix = git("rev-parse", "--show-prefix").decode().strip().rstrip("/")
    tree = f"{revision}:{prefix}" if prefix else revision
    raw = git("archive", "--format=tar.gz", tree)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        for entry in tar:
            path = Path(entry.name)
            if path.is_absolute() or ".." in path.parts or entry.issym() or entry.islnk():
                raise RuntimeError("Unsafe release archive entry")
            if any(p in (".vercel", "node_modules", ".next", ".codex") for p in path.parts):
                raise RuntimeError("Release includes a non-source directory")
            if path.name.startswith(".env") and not path.name.endswith(".example"):
                raise RuntimeError("Release includes a runtime environment file")
            if entry.name.startswith(("funding/data/", "test-results/")):
                raise RuntimeError("Release includes private runtime data")
    return revision, raw


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true")
    group.add_argument("--status", action="store_true")
    group.add_argument("--release", action="store_true")
    group.add_argument("--command-status", metavar="COMMAND_ID")
    args = parser.parse_args()
    session = botocore.session.get_session()
    client = lambda name: session.create_client(name, region_name=REGION)
    identity = client("sts").get_caller_identity()
    if identity["Account"] != ACCOUNT:
        raise RuntimeError("AWS account mismatch; no resources changed")
    cf, ec2, ssm, s3 = (client(name) for name in ("cloudformation", "ec2", "ssm", "s3"))

    def stack():
        return cf.describe_stacks(StackName=STACK)["Stacks"][0]

    if not any(vars(args).values()):
        checks = {}
        for name, call in [
            ("cloudformation", stack),
            ("cloudfront", lambda: client("cloudfront").list_distributions(MaxItems="1")),
            ("amazonLinuxImage", lambda: ssm.get_parameter(Name=AMI_PARAMETER)),
        ]:
            try:
                call()
                checks[name] = "allowed"
            except ClientError as error:
                code = error.response["Error"]["Code"]
                checks[name] = "not-created" if name == "cloudformation" and code == "ValidationError" else code
        print(json.dumps({"mode": "plan", "account": ACCOUNT, "region": REGION, "stack": STACK,
                          "instance": "t4g.small", "diskGiB": 20, "freshStart": True,
                          "oldVercelDataChanged": False, "permissionChecks": checks}))
        return
    if args.apply:
        try:
            current = stack()
        except ClientError as error:
            if error.response["Error"]["Code"] != "ValidationError" or "does not exist" not in error.response["Error"]["Message"]:
                raise
        else:
            print(json.dumps({"status": current["StackStatus"], "message": "Stack exists; use --status or --release. Infrastructure is not replaced automatically."}))
            return
        image = ssm.get_parameter(Name=AMI_PARAMETER)["Parameter"]["Value"]
        body = json.dumps(template())
        cf.validate_template(TemplateBody=body)
        cf.create_stack(StackName=STACK, TemplateBody=body,
                        Parameters=[{"ParameterKey": "ImageId", "ParameterValue": image}],
                        Capabilities=["CAPABILITY_NAMED_IAM"],
                        Tags=[{"Key": "Project", "Value": STACK}], EnableTerminationProtection=True)
        print(json.dumps({"stack": STACK, "status": "creation-requested", "next": "--status"}))
        return

    current = stack()
    outputs = {item["OutputKey"]: item["OutputValue"] for item in current.get("Outputs", [])}
    if args.status:
        events = cf.describe_stack_events(StackName=STACK)["StackEvents"]
        # Resource reasons can include command data. Return only statuses and IDs.
        print(json.dumps({"status": current["StackStatus"], "outputs": outputs, "recent": [
            {"resource": e["LogicalResourceId"], "status": e["ResourceStatus"]} for e in events[:8]]}))
        return
    if current["StackStatus"] not in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
        raise RuntimeError("Infrastructure must be ready before installing an application release")
    instance = outputs["InstanceId"]
    host = ec2.describe_instances(InstanceIds=[instance])["Reservations"][0]["Instances"][0]
    tags = {t["Key"]: t["Value"] for t in host.get("Tags", [])}
    if host["VpcId"] != VPC or tags.get("Project") != STACK or host["InstanceType"] != "t4g.small":
        raise RuntimeError("Deployment instance identity mismatch")
    if args.command_status:
        result = ssm.get_command_invocation(CommandId=args.command_status, InstanceId=instance)
        print(json.dumps({"commandId": args.command_status, "status": result["Status"], "responseCode": result["ResponseCode"]}))
        return

    # Fail before changing anything if the release/configuration is incomplete.
    revision, raw = archive()
    values = runtime(outputs["SiteUrl"])
    managed = ec2.describe_security_groups(Filters=[
        {"Name": "vpc-id", "Values": [VPC]},
        {"Name": "group-name", "Values": ["CloudFront-VPCOrigins-Service-SG*"]},
    ])["SecurityGroups"]
    if len(managed) != 1:
        raise RuntimeError("Cannot identify the CloudFront service-managed security group")
    ingress = {"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80,
               "UserIdGroupPairs": [{"GroupId": managed[0]["GroupId"]}]}
    group = outputs["SecurityGroupId"]
    try:
        ec2.authorize_security_group_ingress(GroupId=group, IpPermissions=[ingress])
    except ClientError as error:
        if error.response["Error"]["Code"] != "InvalidPermission.Duplicate":
            raise
    current_group = ec2.describe_security_groups(GroupIds=[group])["SecurityGroups"][0]
    for rule in current_group["IpPermissions"]:
        if rule.get("PrefixListIds"):
            # EC2 merges sources with the same protocol/port into one rule.
            # Remove only the bootstrap prefix, retaining the new private SG.
            prefix_only = {key: rule[key] for key in ("IpProtocol", "FromPort", "ToPort", "PrefixListIds")}
            ec2.revoke_security_group_ingress(GroupId=group, IpPermissions=[prefix_only])
    locked = ec2.describe_security_groups(GroupIds=[group])["SecurityGroups"][0]["IpPermissions"]
    if len(locked) != 1 or locked[0].get("IpProtocol") != "tcp" or locked[0].get("FromPort") != 80 or locked[0].get("ToPort") != 80:
        raise RuntimeError("Origin ingress verification failed")
    rule = locked[0]
    if any(rule.get(key) for key in ("IpRanges", "Ipv6Ranges", "PrefixListIds")) or [p["GroupId"] for p in rule.get("UserIdGroupPairs", [])] != [managed[0]["GroupId"]]:
        raise RuntimeError("Origin ingress must allow only the CloudFront private security group")
    # Secrets remain in memory until encrypted by SSM; only the parameter name
    # appears in instance commands, CloudFormation, deployment output and Git.
    ssm.put_parameter(Name=PARAMETER, Type="SecureString", Value=json.dumps(values), Overwrite=True)
    key = f"gammaru/briefs/releases/{revision}.tar.gz"
    digest = hashlib.sha256(raw).hexdigest()
    s3.put_object(Bucket=BUCKET, ExpectedBucketOwner=ACCOUNT, Key=key, Body=raw,
                  ServerSideEncryption="AES256", ContentType="application/gzip")
    release = f"/opt/gammaru/releases/{revision}"
    # Commands contain only fixed paths and validated hashes, never credentials.
    commands = [
        "set -eu",
        "test -f /opt/gammaru/bootstrap-ready",
        f"test ! -e {release}",
        f"install -d -m 0755 {release}",
        f"aws s3api get-object --region {REGION} --bucket {BUCKET} --expected-bucket-owner {ACCOUNT} --key {key} {release}/source.tar.gz >/dev/null",
        f"echo {shlex.quote(digest + '  ' + release + '/source.tar.gz')} | sha256sum --check --status",
        f"tar -xzf {release}/source.tar.gz -C {release} --no-same-owner",
        f"bash {release}/scripts/aws-install-release.sh {release} {shlex.quote(outputs['SiteUrl'])}",
    ]
    command = ssm.send_command(InstanceIds=[instance], DocumentName="AWS-RunShellScript",
                               Parameters={"commands": ["\n".join(commands)], "executionTimeout": ["3600"]},
                               TimeoutSeconds=600, Comment=f"Gammaru release {revision[:12]}")
    print(json.dumps({"commandId": command["Command"]["CommandId"], "revision": revision, "site": outputs["SiteUrl"],
                      "status": "install-requested", "dataImported": False}))


if __name__ == "__main__":
    try:
        main()
    except ClientError as error:
        print(json.dumps({"error": error.response["Error"]["Code"], "operation": error.operation_name}), file=sys.stderr)
        sys.exit(1)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Deployment failed; no secret details logged", file=sys.stderr)
        sys.exit(1)

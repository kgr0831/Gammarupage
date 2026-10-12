"""Run with: uv run --no-project --with botocore python scripts/bootstrap-reports-aws.py [--apply].

Creates only the dedicated report bucket and Vercel production OIDC role.
Never creates/prints access keys, changes the Vercel backend, or deletes data.
"""
import argparse
import json
import sys
import botocore.session
from botocore.exceptions import ClientError

ACCOUNT = "066523631431"
REGION = "ap-northeast-2"
BUCKET = f"gammaru-daily-scrum-{ACCOUNT}-seoul"
TEAM = "kgr0831s-projects"
ROLE = "gammaru-reports-vercel"
PREFIXES = ["gammaru/briefs/", "personal/briefs/"]
ISSUER = f"oidc.vercel.com/{TEAM}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    session = botocore.session.get_session()
    account = session.create_client("sts", region_name=REGION).get_caller_identity()["Account"]
    if account != ACCOUNT:
        raise RuntimeError("AWS account mismatch; no resources changed")
    if not args.apply:
        print(json.dumps({"bucket": BUCKET, "region": REGION, "role": ROLE, "mode": "plan", "publicAccess": False}))
        return
    s3 = session.create_client("s3", region_name=REGION)
    iam = session.create_client("iam", region_name="us-east-1")
    try:
        s3.head_bucket(Bucket=BUCKET, ExpectedBucketOwner=ACCOUNT)
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("404", "NoSuchBucket"):
            raise
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}, ObjectOwnership="BucketOwnerEnforced")
    base = {"Bucket": BUCKET, "ExpectedBucketOwner": ACCOUNT}
    if s3.get_bucket_versioning(**base).get("Status") in ("Enabled", "Suspended"):
        raise RuntimeError("Expected an unversioned dedicated bucket; no versioning settings were changed")
    s3.put_public_access_block(**base, PublicAccessBlockConfiguration={
        "BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True, "RestrictPublicBuckets": True,
    })
    s3.put_bucket_encryption(**base, ServerSideEncryptionConfiguration={"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]})
    rules = []
    for prefix in PREFIXES:
        for folder, days in [("html", 7), ("drafts", 1)]:
            rules.append({"ID": prefix.replace("/", "-") + folder, "Status": "Enabled", "Filter": {"Prefix": prefix + folder + "/"}, "Expiration": {"Days": days}})
    # This bucket is dedicated; index-v1.json and all workflow/member records
    # deliberately have no lifecycle expiration rule.
    s3.put_bucket_lifecycle_configuration(**base, LifecycleConfiguration={"Rules": rules})
    provider = f"arn:aws:iam::{ACCOUNT}:oidc-provider/{ISSUER}"
    audience = f"https://vercel.com/{TEAM}"
    try:
        current = iam.get_open_id_connect_provider(OpenIDConnectProviderArn=provider)
        if audience not in current["ClientIDList"]:
            raise RuntimeError("Existing provider audience differs; review required")
    except ClientError as error:
        if error.response["Error"]["Code"] != "NoSuchEntity":
            raise
        iam.create_open_id_connect_provider(Url=f"https://{ISSUER}", ClientIDList=[audience])
    trust = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Federated": provider}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {
        f"{ISSUER}:aud": audience, f"{ISSUER}:sub": f"owner:{TEAM}:project:gammarupage:environment:production",
    }}}]}
    try:
        iam.get_role(RoleName=ROLE)
        iam.update_assume_role_policy(RoleName=ROLE, PolicyDocument=json.dumps(trust))
    except ClientError as error:
        if error.response["Error"]["Code"] != "NoSuchEntity":
            raise
        iam.create_role(RoleName=ROLE, AssumeRolePolicyDocument=json.dumps(trust), Description="Gammaru production report storage only")
    policy = {"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": f"arn:aws:s3:::{BUCKET}", "Condition": {"StringLike": {"s3:prefix": [p + "*" for p in PREFIXES]}}},
        {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": [f"arn:aws:s3:::{BUCKET}/{p}*" for p in PREFIXES]},
    ]}
    iam.put_role_policy(RoleName=ROLE, PolicyName="ReportStorage", PolicyDocument=json.dumps(policy))
    print(json.dumps({"bucket": BUCKET, "region": REGION, "roleArn": f"arn:aws:iam::{ACCOUNT}:role/{ROLE}", "publicAccess": False, "lifecycleRules": len(rules), "backendSwitched": False}))


if __name__ == "__main__":
    try:
        main()
    except ClientError as error:
        print(json.dumps({"error": error.response["Error"]["Code"], "operation": error.operation_name}), file=sys.stderr)
        sys.exit(1)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

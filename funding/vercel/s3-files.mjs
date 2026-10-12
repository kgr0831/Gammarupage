import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { check } from "../schema.mjs";

export class S3Files {
  constructor({ bucket, region, expectedOwner, roleArn }, client) {
    check(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || "") && region === "ap-northeast-2" && /^\d{12}$/.test(expectedOwner || ""), "AWS 보고서 저장소 설정을 확인해 주세요.", 503);
    check(client || !process.env.VERCEL || roleArn, "AWS 보고서 접근 역할을 설정해 주세요.", 503);
    this.base = { Bucket: bucket, ExpectedBucketOwner: expectedOwner };
    this.client = client || new S3Client({ region, maxAttempts: 3, ...(roleArn ? { credentials: awsCredentialsProvider({ roleArn }) } : {}) });
  }
  key(path) {
    check(/^(gammaru|personal)\/briefs\/[a-zA-Z0-9/._-]+$/.test(path) && !path.split("/").some(part => ["", ".", ".."].includes(part)), "보고서 파일 경로를 확인해 주세요.", 400);
    return { ...this.base, Key: path };
  }
  async send(command) {
    try { return await this.client.send(command, { abortSignal: AbortSignal.timeout(15000) }); }
    catch (error) {
      if (["AccessDenied", "InvalidAccessKeyId", "ExpiredToken", "CredentialsProviderError"].includes(error.name)) throw Object.assign(new Error("AWS 보고서 저장소 접근 권한을 확인해 주세요."), { status: 503, code: "S3_ACCESS_DENIED" });
      throw error;
    }
  }
  async read(path) {
    try {
      // S3 reads are strongly consistent. Never cache sessions or CAS state.
      const result = await this.send(new GetObjectCommand(this.key(path)));
      check(result.Body && result.ETag, "AWS 보고서 파일을 읽지 못했습니다.", 502);
      return { text: await result.Body.transformToString("utf-8"), etag: result.ETag };
    } catch (error) {
      // A missing bucket or denied request is not an empty, new database.
      if (error.name === "NoSuchKey") return null;
      throw error;
    }
  }
  async write(path, text, etag = null) {
    try {
      const result = await this.send(new PutObjectCommand({
        ...this.key(path), Body: text, ContentType: path.endsWith(".html") ? "text/html; charset=utf-8" : "application/json",
        ServerSideEncryption: "AES256", CacheControl: "private, no-store",
        ...(etag === null ? { IfNoneMatch: "*" } : { IfMatch: etag }),
      }));
      return { etag: result.ETag };
    } catch (error) {
      if (["PreconditionFailed", "ConditionalRequestConflict"].includes(error.name) || error.$metadata?.httpStatusCode === 412) throw Object.assign(new Error("Storage conflict"), { conflict: true });
      throw error;
    }
  }
  async remove(path) { await this.send(new DeleteObjectCommand(this.key(path))); }
  async list(prefix) {
    check(["gammaru/briefs/", "personal/briefs/"].includes(prefix), "Invalid report prefix.");
    const rows = []; let token;
    do {
      const result = await this.send(new ListObjectsV2Command({ ...this.base, Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) }));
      rows.push(...(result.Contents || []).map(row => ({ pathname: row.Key, size: row.Size })));
      token = result.IsTruncated ? result.NextContinuationToken : null;
      check(!result.IsTruncated || token, "Incomplete S3 listing.", 502);
    } while (token);
    return rows;
  }
}

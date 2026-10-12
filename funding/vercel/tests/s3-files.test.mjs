import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Files } from "../s3-files.mjs";
import { BriefStore } from "../storage.mjs";

const config = { bucket: "report-test-only", region: "ap-northeast-2", expectedOwner: "123456789012" };
test("actual S3 SDK sends private, owner-bound conditional writes and concurrent edits preserve both updates", async () => {
  let version = 0, saved = null;
  const client = new S3Client({ region: config.region, maxAttempts: 1, credentials: { accessKeyId: "test-only", secretAccessKey: "test-only" }, requestHandler: { handle: async request => {
    assert.equal(request.headers["x-amz-expected-bucket-owner"], config.expectedOwner);
    assert.equal(request.hostname, "report-test-only.s3.ap-northeast-2.amazonaws.com");
    const response = (statusCode, body, headers = {}) => ({ response: { statusCode, headers, body: Readable.from([body]) } });
    if (request.method === "GET") return saved === null ? response(404, "<Error><Code>NoSuchKey</Code></Error>") : response(200, saved, { etag: `"${version}"` });
    assert.equal(request.method, "PUT");
    assert.equal(request.headers["x-amz-server-side-encryption"], "AES256");
    assert.equal(request.headers["cache-control"], "private, no-store");
    if (saved === null) assert.equal(request.headers["if-none-match"], "*");
    else if (request.headers["if-match"] !== `"${version}"`) return response(412, "<Error><Code>PreconditionFailed</Code></Error>");
    saved = String(request.body); version++;
    return response(200, "", { etag: `"${version}"` });
  } } });
  const files = new S3Files(config, client), one = new BriefStore(files), two = new BriefStore(files);
  await one.update(state => { state.members.first = { status: "pending" }; });
  await Promise.all([one.update(state => { state.members.first.status = "approved"; }), two.update(state => { state.members.second = { status: "approved" }; })]);
  const state = await one.read();
  assert.equal(state.members.first.status, "approved");
  assert.equal(state.members.second.status, "approved");
  assert.equal(version, 3);
  client.destroy();
});

test("S3 errors never turn a denied or missing bucket into an empty database; conflicts are retryable", async () => {
  for (const name of ["NoSuchBucket", "AccessDenied", "ExpiredToken", "ConditionalRequestConflict"]) {
    const files = new S3Files(config, { send: async () => { throw Object.assign(new Error("Private provider detail"), { name }); } });
    await assert.rejects(files.read("gammaru/briefs/index-v1.json"));
    await assert.rejects(files.write("gammaru/briefs/index-v1.json", "{}"), error => name === "ConditionalRequestConflict" ? error.conflict === true : name === "NoSuchBucket" || (error.status === 503 && !error.message.includes("Private provider detail")));
  }
  const files = new S3Files(config, { send: async () => assert.fail("Invalid keys must not reach AWS") });
  for (const key of ["other/index.json", "personal/briefs/../../gammaru/index.json", "personal/briefs//index.json"]) await assert.rejects(files.read(key));
  assert.throws(() => new S3Files({ ...config, expectedOwner: "" }, {}));
});

import { BriefStore, PrivateBlobFiles } from "./storage.mjs";
import { S3Files } from "./s3-files.mjs";
import { check } from "../schema.mjs";

export function createReportStore(config) {
  const backend = config.storageBackend || "blob";
  check(["blob", "s3"].includes(backend), "보고서 저장소 종류를 확인해 주세요.", 503);
  const files = backend === "s3" ? new S3Files(config.s3 || {}) : new PrivateBlobFiles(config.blobToken);
  return new BriefStore(files, config.service === "personal" ? "personal/briefs" : "gammaru/briefs");
}

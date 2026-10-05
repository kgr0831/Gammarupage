import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digest } from "../schema.mjs";

// Single-process local development storage; production continues to use Private Blob.
export class LocalFiles {
  #pending = Promise.resolve();
  constructor(root) { this.root = path.resolve(root); }
  resolve(key) {
    if (!/^personal\/briefs\/[a-zA-Z0-9/._-]+$/.test(key) || key.split("/").some(part => [".", ".."].includes(part))) throw new Error("Invalid local storage key");
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) throw new Error("Invalid local storage path");
    return target;
  }
  async read(key) {
    const target = this.resolve(key);
    try { const text = await readFile(target, "utf8"); return { text, etag: digest(text) }; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async write(key, text, etag = null) {
    const operation = this.#pending.then(async () => {
      const target = this.resolve(key), previous = await this.read(key);
      if ((etag === null && previous) || (etag !== null && previous?.etag !== etag)) throw Object.assign(new Error("Storage conflict"), { conflict: true });
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, target);
      return { etag: digest(text) };
    });
    this.#pending = operation.catch(() => {});
    return operation;
  }
}

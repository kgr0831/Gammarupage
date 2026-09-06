import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import sharp from "sharp";

const root = process.cwd();
const selections = JSON.parse(await readFile(path.join(root, "scripts/video-stills.config.json"), "utf8"));
const games = JSON.parse(await readFile(path.join(root, "src/data/archive/games.json"), "utf8"));
const sources = await readdir(path.join(root, "GameVideo"), { recursive: true });
const manifest = {};
const previews = [];
let totalBytes = 0;

for (const selection of selections) {
  const game = games.find((item) => item.uid === selection.uid);
  if (!game || game.title !== selection.title) throw new Error(`Game identity changed: ${selection.uid}`);
  if (game.media.cover) {
    console.log(`Keeping existing artwork: ${game.title}`);
    continue;
  }
  if (manifest[game.uid]) throw new Error(`Duplicate game: ${game.uid}`);
  const matches = sources.filter((file) => path.basename(file) === selection.source);
  if (matches.length !== 1) throw new Error(`Expected one source for ${game.uid}, found ${matches.length}`);
  const directory = path.join(root, "public/archive/video-stills", game.uid);
  await mkdir(directory, { recursive: true });
  const images = [];
  for (const [index, seconds] of selection.seconds.entries()) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`Invalid timestamp for ${game.uid}`);
    const frame = await capture(path.join(root, "GameVideo", matches[0]), seconds);
    const pipeline = sharp(frame);
    if (selection.crop) pipeline.extract(selection.crop);
    pipeline.resize({ width: 1280, height: 900, fit: "inside", withoutEnlargement: true });
    const [webp, avif] = await Promise.all([
      pipeline.clone().webp({ quality: 82 }).toBuffer(),
      pipeline.clone().avif({ quality: 55, effort: 5 }).toBuffer(),
    ]);
    const hash = createHash("sha256").update(webp).update(avif).digest("hex").slice(0, 12);
    const role = index === 0 ? "cover" : `screenshot-${String(index).padStart(2, "0")}`;
    const name = `${role}-${hash}`;
    await Promise.all([
      writeFile(path.join(directory, `${name}.webp`), webp),
      writeFile(path.join(directory, `${name}.avif`), avif),
    ]);
    totalBytes += webp.length + avif.length;
    const prefix = `/archive/video-stills/${game.uid}/${name}`;
    images.push({ webp: `${prefix}.webp`, avif: `${prefix}.avif` });
    previews.push({ uid: game.uid, seconds, buffer: webp });
  }
  if (images.length < 1) throw new Error(`Missing cover for ${game.uid}`);
  manifest[game.uid] = { source: selection.source, seconds: selection.seconds, cover: images[0], screenshots: images.slice(1) };
  console.log(`Captured ${images.length} images: ${game.title}`);
}

await writeFile(path.join(root, "src/data/archive/video-stills.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Local-only contact sheets make it easy to review every selected frame.
const previewDirectory = path.join(root, "test-results/video-stills");
await mkdir(previewDirectory, { recursive: true });
for (let offset = 0; offset < previews.length; offset += 15) {
  const entries = previews.slice(offset, offset + 15);
  const tiles = [];
  for (const [index, entry] of entries.entries()) {
    const left = (index % 3) * 480;
    const top = Math.floor(index / 3) * 300;
    tiles.push({ input: await sharp(entry.buffer).resize(480, 270, { fit: "contain", background: "#080918" }).toBuffer(), left, top });
    const label = `<svg width="480" height="30"><text x="10" y="21" fill="white" font-family="Arial" font-size="16">${entry.uid} / ${entry.seconds}s</text></svg>`;
    tiles.push({ input: Buffer.from(label), left, top: top + 270 });
  }
  await sharp({ create: { width: 1440, height: Math.ceil(entries.length / 3) * 300, channels: 3, background: "#080918" } })
    .composite(tiles).jpeg({ quality: 90 }).toFile(path.join(previewDirectory, `contact-${offset / 15 + 1}.jpg`));
}
console.log(`${Object.keys(manifest).length} games, ${previews.length} frames, ${(totalBytes / 1e6).toFixed(2)} MB including both formats.`);

function capture(source, seconds) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", source,
      "-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], { windowsHide: true });
    const chunks = [];
    let error = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { error = (error + chunk).slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => {
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || !buffer.length) reject(new Error(`Capture failed at ${seconds}s: ${error}`));
      else resolve(buffer);
    });
  });
}

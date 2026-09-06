import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import sharp from "sharp";

const root = process.cwd();
const preview = path.join(root, "test-results/reel-v2");
const master = path.join(preview, "gammaru-reel-v2.mp4");
const edit = JSON.parse(await readFile(path.join(preview, "manifest.json"), "utf8"));
const staging = path.join(preview, "delivery");
await mkdir(staging, { recursive: true });
const renditions = [
  { codec: "av1", height: 540, width: 960, crf: 38, codecs: "av01.0.08M.08" },
  { codec: "av1", height: 1080, width: 1920, crf: 38, codecs: "av01.0.08M.08" },
  { codec: "h264", height: 540, width: 960, crf: 27, codecs: "avc1.640028" },
  { codec: "h264", height: 1080, width: 1920, crf: 28, codecs: "avc1.640028" },
];
const hash = createHash("sha256").update(await readFile(master)).update(JSON.stringify(renditions)).update("hls-v1-4s");
for (const rendition of renditions) {
  rendition.name = `${rendition.codec}-${rendition.height}`;
  rendition.file = path.join(staging, `${rendition.name}.mp4`);
  console.log(`Encoding ${rendition.name} with aligned 4-second keyframes...`);
  const encoder = rendition.codec === "av1"
    ? ["-c:v", "libaom-av1", "-crf", String(rendition.crf), "-b:v", "0", "-cpu-used", "6", "-row-mt", "1", "-tiles", "2x2", "-threads", "8"]
    : ["-c:v", "libx264", "-preset", "slow", "-crf", String(rendition.crf), "-profile:v", "high", "-level:v", "4.0", "-sc_threshold", "0", "-threads", "6"];
  if (!process.argv.includes("--reuse-encodes")) await run(["-i", master, "-vf", `scale=${rendition.width}:${rendition.height}`, "-an", ...encoder,
    "-g", "120", "-force_key_frames", "expr:gte(t,n_forced*4)", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", rendition.file]);
  hash.update(await readFile(rendition.file));
}
const poster = await sharp(path.join(preview, "poster.jpg")).resize(960).webp({ quality: 76 }).toBuffer();
hash.update(poster);
const version = hash.digest("hex").slice(0, 12);
const publicPath = `/media/reel/${version}`;
const destination = path.join(root, "public", publicPath);
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, "poster.webp"), poster);
for (const rendition of renditions) {
  const directory = path.join(destination, rendition.name);
  await mkdir(directory, { recursive: true });
  await run(["-i", rendition.file, "-map", "0:v:0", "-c", "copy", "-f", "hls", "-hls_time", "4",
    "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4", "-hls_flags", "independent_segments",
    "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", "segment-%03d.m4s", "index.m3u8"], directory);
  const playlist = await readFile(path.join(directory, "index.m3u8"), "utf8");
  const segments = [...playlist.matchAll(/#EXTINF:([\d.]+),\r?\n([^\r\n]+)/g)];
  let bytes = (await stat(path.join(directory, "init.mp4"))).size;
  let peak = 0;
  let totalDuration = 0;
  for (const [index, [, seconds, file]] of segments.entries()) {
    const duration = Number(seconds);
    if (index < segments.length - 1 && Math.abs(duration - 4) > 0.04) throw new Error(`Unaligned segment: ${rendition.name}/${file}: ${duration}s`);
    const size = (await stat(path.join(directory, file))).size;
    bytes += size;
    totalDuration += duration;
    peak = Math.max(peak, size * 8 / duration);
  }
  if (Math.abs(totalDuration - edit.duration) > 0.1) throw new Error(`Incorrect duration: ${rendition.name}`);
  Object.assign(rendition, { bytes, bandwidth: Math.ceil(peak * 1.1), averageBandwidth: Math.ceil(bytes * 8 / totalDuration) });
  if (rendition.codec === "h264") await copyFile(rendition.file, path.join(destination, `${rendition.name}.mp4`));
  console.log(`${rendition.name}: ${segments.length} segments, ${(bytes / 1e6).toFixed(2)} MB`);
}
const streams = {};
for (const codec of ["av1", "h264"]) {
  const variants = renditions.filter((item) => item.codec === codec);
  const playlist = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS", ...variants.flatMap((item) => [
    `#EXT-X-STREAM-INF:BANDWIDTH=${item.bandwidth},AVERAGE-BANDWIDTH=${item.averageBandwidth},RESOLUTION=${item.width}x${item.height},FRAME-RATE=30.000,CODECS="${item.codecs}"`,
    `${item.name}/index.m3u8`,
  ]), ""].join("\n");
  await writeFile(path.join(destination, `${codec}.m3u8`), playlist);
  streams[codec] = {
    playlist: `${publicPath}/${codec}.m3u8`,
    codecs: variants[0].codecs,
    variants: variants.map(({ name, height, width, bytes, averageBandwidth }) => ({
      height, width, bytes, bitrate: averageBandwidth, playlist: `${publicPath}/${name}/index.m3u8`,
    })),
  };
}
const manifest = {
  version, duration: edit.duration, fps: edit.fps, muted: true, loop: true, segmentDuration: 4,
  poster: `${publicPath}/poster.webp`, streams,
  fallback: { mobile: `${publicPath}/h264-540.mp4`, desktop: `${publicPath}/h264-1080.mp4` },
  games: edit.games, timeline: edit.timeline,
};
await writeFile(path.join(root, "src/data/hero-reel-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Packaged ${publicPath}. Previous versions are not deleted automatically.`);
console.log(`Top-level files: ${(await readdir(destination)).join(", ")}`);

async function run(args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-y", ...args], { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (chunk) => { log = (log + chunk).slice(-12000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(log)));
  });
}

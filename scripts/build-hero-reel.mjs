import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const root = process.cwd();
const sourceRoot = path.join(root, "GameVideo");
const outputRoot = path.join(root, "public", "media");
const catalogOnly = process.argv.includes("--catalog");
const samplesOnly = process.argv.includes("--samples");
const durationPerClip = 4;
const transitionDuration = 0.6;

const selections = [
  { title: "감금학과대학원", award: "2026 겨울공모전 1위", match: /감금학과대학원/i },
  { title: "AfterBed", award: "2026 겨울공모전 3위", match: /After bed/i },
  { title: "신출귀몰", award: "2025 여름공모전 3위", match: /신출귀몰/i },
  { title: "마나 리로디드", award: "2025 여름공모전 인기상", match: /마나 리로디드/i },
  { title: "ChronoFactory", award: null, match: /ChronoFactory/i },
  { title: "병아리대탈출", award: null, match: /병아리 대탈출/i },
  { title: "새벽기차", award: null, match: /DawnTrain/i },
  { title: "드래곤전", award: null, match: /드래곤전.*\.(mov|mp4)$/i },
];

if (!ffmpegPath) throw new Error("ffmpeg-static binary is unavailable.");

const videoFiles = (await walk(sourceRoot)).filter((file) => /\.(mp4|mov|mkv|webm)$/i.test(file));
const catalog = videoFiles.map(probe).filter(Boolean);

if (catalogOnly) {
  console.table(catalog.map(({ relative, width, height, duration }) => ({ relative, width, height, duration: duration.toFixed(1) })));
  process.exit(0);
}

const chosen = selections.map((selection) => {
  const video = catalog.find((item) => selection.match.test(item.relative));
  if (!video) throw new Error(`No source video found for ${selection.title}`);
  if (video.width < 1280 || video.height < 720) {
    throw new Error(`${selection.title} is below the 1280x720 quality floor (${video.width}x${video.height}).`);
  }
  if (video.duration < durationPerClip + 2) throw new Error(`${selection.title} is too short for the reel.`);
  return { ...selection, ...video, start: pickStart(video.duration) };
});

if (samplesOnly) {
  const sampleRoot = path.join(root, "test-results", "video-samples");
  await mkdir(sampleRoot, { recursive: true });
  for (const [index, item] of chosen.entries()) {
    run(["-y", "-ss", item.start.toFixed(3), "-i", item.file, "-frames:v", "1", "-update", "1", "-vf", "scale=960:-2", path.join(sampleRoot, `${String(index + 1).padStart(2, "0")}-${item.title}.jpg`)]);
  }
  console.log(`Created ${chosen.length} midpoint samples in ${sampleRoot}.`);
  process.exit(0);
}

const inputArgs = chosen.flatMap((item) => ["-ss", item.start.toFixed(3), "-t", String(durationPerClip + 1), "-i", item.file]);
const filters = [];
for (let index = 0; index < chosen.length; index += 1) {
  const source = index < 4 ? `[${index}:v]split=2[s${index}][m${index}]` : `[${index}:v]null[s${index}]`;
  filters.push(source);
  filters.push(`[s${index}]fps=30,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,format=yuv420p,setpts=PTS-STARTPTS,trim=duration=${durationPerClip}[v${index}]`);
  if (index < 4) {
    filters.push(`[m${index}]fps=30,scale=960:540:force_original_aspect_ratio=increase,crop=960:540,setsar=1,format=yuv420p,setpts=PTS-STARTPTS,trim=duration=${durationPerClip}[tile${index}]`);
  }
}

filters.push("[tile0][tile1][tile2][tile3]xstack=inputs=4:layout=0_0|960_0|0_540|960_540:fill=black[mosaic]");

let previous = "v0";
for (let index = 1; index < chosen.length; index += 1) {
  const next = `mix${index}`;
  const offset = (index * (durationPerClip - transitionDuration)).toFixed(3);
  filters.push(`[${previous}][v${index}]xfade=transition=fade:duration=${transitionDuration}:offset=${offset}[${next}]`);
  previous = next;
}
const mosaicOffset = (chosen.length * (durationPerClip - transitionDuration)).toFixed(3);
filters.push(`[${previous}][mosaic]xfade=transition=pixelize:duration=${transitionDuration}:offset=${mosaicOffset},format=yuv420p[outv]`);

const mp4 = path.join(outputRoot, "hero-reel.mp4");
const webm = path.join(outputRoot, "hero-reel.webm");
run([
  "-y", ...inputArgs,
  "-filter_complex", filters.join(";"),
  "-map", "[outv]", "-map_metadata", "-1", "-an", "-r", "30",
  "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-movflags", "+faststart",
  mp4,
]);
run([
  "-y", "-i", mp4, "-map_metadata", "-1", "-an", "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0",
  "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", webm,
]);

await writeFile(
  path.join(root, "src", "data", "hero-reel-manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), width: 1920, height: 1080, muted: true, clips: chosen.map(({ title, award, relative, start }) => ({ title, award, source: relative, start: Number(start.toFixed(3)), duration: durationPerClip })) }, null, 2)}\n`,
  "utf8",
);

console.log(`Hero reel created from ${chosen.length} source videos.`);

function run(args) {
  const result = spawnSync(ffmpegPath, ["-hide_banner", ...args], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) throw new Error(`ffmpeg exited with status ${result.status}`);
}

function probe(file) {
  const result = spawnSync(ffmpegPath, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoMatch = output.match(/Video:.*?(\d{3,5})x(\d{3,5})/);
  if (!durationMatch || !videoMatch) return null;
  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  return {
    file,
    relative: path.relative(root, file).replaceAll("\\", "/"),
    width: Number(videoMatch[1]),
    height: Number(videoMatch[2]),
    duration,
  };
}

function pickStart(duration) {
  const preferred = duration * 0.42;
  return Math.max(1, Math.min(preferred, duration - durationPerClip - 1));
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}

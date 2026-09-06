import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import sharp from "sharp";

const root = process.cwd();
const output = path.join(root, "test-results", "reel-v2");
const width = 1920;
const height = 1080;
const fps = 30;
const samplesOnly = process.argv.includes("--samples");
const selections = [
  { id: "mana", title: "마나 리로디드", match: /마나 리로디드.*\.mp4$/, start: 55.86 },
  { id: "pigment", title: "PigmentEscape", match: /PigmentEscape.*\.mp4$/, start: 18 },
  { id: "ghost", title: "신출귀몰", match: /신출귀몰_플레이영상\.mp4$/, start: 19.55 },
  { id: "planet", title: "PLANET1101", match: /PLANET1101.*\.mp4$/, start: 66 },
  { id: "after", title: "AfterBed", match: /After bed.*\.mp4$/, start: 1372.45 },
  { id: "escape", title: "EscapeFactory", match: /EscapeFactory_플레이영상\.mp4$/, start: 30 },
  { id: "chick", title: "병아리 대탈출!", match: /병아리 대탈출.*\.mp4$/, start: 77.49 },
  { id: "chrono", title: "ChronoFactory", match: /ChronoFactory.*\.mp4$/, start: 320.36 },
  { id: "beat", title: "Escape on Beat", match: /escapr on beat.*\.mp4$/, start: 80, contain: true },
  { id: "train", title: "새벽기차", match: /DawnTrain.*12-28-51\.mp4$/, start: 35.37 },
  { id: "dragon", title: "드래곤전", match: /드래곤전.*MP4\.mov$/, start: 492.22 },
  { id: "grad", title: "감금학과대학원", match: /감금학과대학원.*\.mp4$/, start: 975 },
];

await mkdir(output, { recursive: true });
if (process.argv.includes("--av1")) {
  const file = path.join(output, "gammaru-reel-v2-av1.mp4");
  console.log("Encoding AV1 preview at 1080p...");
  await run(["-i", path.join(output, "gammaru-reel-v2.mp4"), "-an", "-c:v", "libaom-av1", "-crf", "36", "-b:v", "0", "-cpu-used", "6", "-row-mt", "1", "-tiles", "2x2", "-threads", "8", "-g", "120", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", file]);
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files.av1 = { name: path.basename(file), bytes: (await stat(file)).size };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`AV1 preview: ${(manifest.files.av1.bytes / 1e6).toFixed(2)} MB`);
  process.exit(0);
}
const files = await walk(path.join(root, "GameVideo"));
for (const item of selections) {
  item.file = files.find((file) => item.match.test(file.replaceAll("\\", "/")));
  if (!item.file) throw new Error(`Missing source: ${item.title}`);
}

if (samplesOnly) {
  for (let page = 0; page < 3; page++) {
    const tiles = [];
    for (const [row, item] of selections.slice(page * 4, page * 4 + 4).entries()) {
      const probe = await run(["-i", item.file], true);
      const time = probe.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const duration = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
      for (let col = 0; col < 4; col++) {
        const start = col === 0 ? item.start : duration * [0, 0.25, 0.55, 0.75][col];
        const file = path.join(output, `sample-${item.id}-${col}.jpg`);
        await run(["-ss", String(start), "-i", item.file, "-frames:v", "1", "-vf", "scale=360:202:force_original_aspect_ratio=decrease,pad=360:202:(ow-iw)/2:(oh-ih)/2:color=0x080918", "-update", "1", file]);
        tiles.push({ input: file, left: col * 360, top: row * 230 });
        const label = `<svg width="360" height="28"><rect width="360" height="28" fill="#10121f"/><text x="10" y="20" fill="white" font-family="Arial" font-size="14">${item.id} / ${start.toFixed(2)}s</text></svg>`;
        tiles.push({ input: Buffer.from(label), left: col * 360, top: row * 230 + 202 });
      }
    }
    await sharp({ create: { width: 1440, height: 920, channels: 3, background: "#080918" } }).composite(tiles).jpeg({ quality: 90 }).toFile(path.join(output, `sources-${page + 1}.jpg`));
    console.log(`Source sheet ${page + 1}/3 ready`);
  }
} else {
  const byId = Object.fromEntries(selections.map((item) => [item.id, item]));
  const shots = [
    { games: ["mana"], duration: 2.4, transition: "fade", chapter: "PRESS PLAY" },
    { games: ["ghost"], duration: 2.2, transition: "diagtl" },
    { games: ["escape"], duration: 2.4, transition: "smoothleft", starts: [40] },
    { games: ["chick"], duration: 2.3, transition: "circleopen", starts: [101] },
    { games: ["mana", "ghost", "chick", "dragon"], duration: 3.3, transition: "pixelize", chapter: "DIFFERENT WORLDS. SAME PLAY." },
    { games: ["planet"], duration: 2.2, transition: "smoothright", starts: [87.5] },
    { games: ["grad"], duration: 2.4, transition: "fade" },
    { games: ["chrono"], duration: 2.2, transition: "slideup", starts: [190] },
    { games: ["planet", "pigment", "beat", "chrono"], duration: 2.8, transition: "pixelize", chapter: "FIND YOUR NEXT WORLD" },
    { games: ["after"], duration: 2.4, transition: "smoothleft", starts: [1797] },
    { games: ["train"], duration: 2.4, transition: "fade", starts: [46] },
    { games: ["dragon"], duration: 2.4, transition: "wipeup", starts: [492] },
    { games: ["after", "chrono", "escape", "grad"], duration: 3.1, transition: "pixelize", chapter: "BUILT BY GAMMARU" },
    { games: ["chick"], duration: 1.4, transition: "cut", starts: [138] },
    { games: ["ghost"], duration: 1.4, transition: "cut", starts: [25.5] },
    { games: ["mana"], duration: 1.4, transition: "cut", starts: [73] },
    { games: ["escape"], duration: 1.4, transition: "cut", starts: [18.5] },
    { games: ["planet"], duration: 1.4, transition: "cut", starts: [119] },
    { games: ["dragon"], duration: 1.6, transition: "cut", starts: [644] },
    { games: ["grad"], duration: 1.6, transition: "cut", starts: [1329] },
    { games: ["chick", "ghost", "escape", "mana"], duration: 3, transition: "smoothup", chapter: "ONE MORE ROUND" },
  ];
  const cache = path.join(output, "shots");
  await mkdir(cache, { recursive: true });
  for (const [index, shot] of shots.entries()) {
    shot.file = path.join(cache, `${String(index + 1).padStart(2, "0")}.mp4`);
    const overlay = path.join(cache, `${String(index + 1).padStart(2, "0")}.png`);
    await sharp(Buffer.from(overlaySvg(shot, index, byId))).png().toFile(overlay);
    const args = [];
    const filters = [];
    for (const [slot, id] of shot.games.entries()) {
      const game = byId[id];
      const start = shot.starts?.[slot] ?? game.start;
      args.push("-threads", "2", "-ss", String(start), "-t", String(shot.duration), "-i", game.file);
      const w = shot.games.length === 1 ? width : width / 2 - 6;
      const h = shot.games.length === 1 ? height : height / 2 - 6;
      // Preserve the narrow rhythm game's frame; remove the train recording's baked-in letterbox.
      const crop = id === "train" ? "crop=1920:660:0:210," : "";
      const fit = game.contain
        ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x080918`
        : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
      filters.push(`[${slot}:v]${crop}fps=${fps},${fit},setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS,trim=duration=${shot.duration}[tile${slot}]`);
    }
    if (shot.games.length === 4) {
      filters.push(`[tile0][tile1][tile2][tile3]xstack=inputs=4:layout=0_0|966_0|0_546|966_546:fill=0x080918,pad=${width}:${height}:0:0:color=0x080918[scene]`);
    } else {
      filters.push("[tile0]null[scene]");
    }
    args.push("-loop", "1", "-i", overlay);
    filters.push(`[scene][${shot.games.length}:v]overlay=shortest=1:format=auto,format=yuv420p[out]`);
    await run([...args, "-filter_complex_threads", "1", "-filter_complex", filters.join(";"), "-map", "[out]", "-t", String(shot.duration), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-threads", "4", "-map_metadata", "-1", shot.file]);
    console.log(`Shot ${index + 1}/${shots.length}: ${shot.games.map((id) => byId[id].title).join(" / ")}`);
  }

  const args = shots.flatMap((shot) => ["-threads", "1", "-i", shot.file]);
  const filters = shots.map((_, i) => `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  const timeline = [{ at: 0, ...describe(shots[0], byId) }];
  let duration = shots[0].duration;
  let previous = "v0";
  for (let i = 1; i < shots.length; i++) {
    const shot = shots[i];
    const name = `mix${i}`;
    const overlap = shot.transition === "cut" ? 0 : 0.3;
    if (overlap) {
      filters.push(`[${previous}][v${i}]xfade=transition=${shot.transition}:duration=${overlap}:offset=${(duration - overlap).toFixed(6)}[${name}]`);
    } else {
      filters.push(`[${previous}][v${i}]concat=n=2:v=1:a=0,settb=AVTB[${name}]`);
    }
    timeline.push({ at: Number((duration - overlap).toFixed(3)), ...describe(shot, byId) });
    duration += shot.duration - overlap;
    previous = name;
  }
  // Blend the ending into the first 0.4 seconds, then start playback at that same point.
  args.push("-threads", "1", "-i", shots[0].file);
  filters.push(`[${shots.length}:v]trim=duration=0.4,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[head]`);
  filters.push(`[${previous}][head]xfade=transition=fade:duration=0.4:offset=${(duration - 0.4).toFixed(6)},trim=start=0.4,setpts=PTS-STARTPTS,format=yuv420p[out]`);
  const master = path.join(output, "gammaru-reel-v2.mp4");
  console.log(`Compositing ${(duration - 0.4).toFixed(1)}s loop at 1080p...`);
  await run([...args, "-filter_complex_threads", "1", "-filter_complex", filters.join(";"), "-map", "[out]", "-an", "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-threads", "6", "-movflags", "+faststart", "-map_metadata", "-1", master]);
  const manifest = {
    duration: Number((duration - 0.4).toFixed(3)), width, height, fps,
    games: selections.map(({ id, title }) => ({ id, title })),
    timeline: timeline.map((shot) => ({ ...shot, at: Math.max(0, Number((shot.at - 0.4).toFixed(3))) })),
    files: { mp4: { name: path.basename(master), bytes: (await stat(master)).size } },
  };
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await run(["-i", master, "-vf", "fps=1/2.2,scale=384:216,tile=5x4", "-frames:v", "1", "-update", "1", path.join(output, "contact-sheet.jpg")]);
  await run(["-ss", "0", "-i", master, "-frames:v", "1", "-update", "1", path.join(output, "poster.jpg")]);
  console.log(`Preview ready: ${master} (${(manifest.files.mp4.bytes / 1e6).toFixed(2)} MB)`);
}

function describe(shot, byId) {
  return { duration: shot.duration, games: shot.games.map((id) => byId[id].title), transition: shot.transition, chapter: shot.chapter ?? null };
}

function overlaySvg(shot, index, byId) {
  const isGrid = shot.games.length === 4;
  const accent = index % 3 === 1 ? "#ef62bd" : "#b8ee63";
  const title = isGrid ? shot.chapter : byId[shot.games[0]].title;
  const tileLabels = isGrid ? shot.games.map((id, slot) => {
    const x = (slot % 2) * 966 + 30;
    const y = Math.floor(slot / 2) * 546 + 62;
    return `<rect x="${x - 10}" y="${y - 31}" width="310" height="45" rx="3" fill="#080918" fill-opacity=".82"/><text x="${x}" y="${y}" fill="#f4f0e8" font-size="23">${byId[id].title}</text>`;
  }).join("") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#080918" stop-opacity="0"/><stop offset="1" stop-color="#080918" stop-opacity=".87"/></linearGradient></defs>
    <g font-family="Malgun Gothic, Arial, sans-serif">
      <rect x="0" y="858" width="1920" height="222" fill="url(#shade)"/>
      ${isGrid ? "" : `<rect x="48" y="47" width="6" height="27" fill="${accent}"/>
      <rect x="69" y="40" width="355" height="42" rx="3" fill="#080918" fill-opacity=".72"/>
      <text x="82" y="68" fill="#f4f0e8" font-size="22" font-weight="700" letter-spacing="3">GAMMARU / PLAY REEL</text>`}
      <path d="M1840 46h32v32 M48 890v-28h28" stroke="${accent}" stroke-width="3" fill="none"/>
      <rect x="49" y="968" width="4" height="63" fill="${accent}"/>
      <text x="73" y="986" fill="${accent}" font-size="17" letter-spacing="4">${String(index + 1).padStart(2, "0")} / ${isGrid ? "SPLIT SCREEN" : "GAME IN MOTION"}</text>
      <text x="71" y="1028" fill="#f4f0e8" font-size="33" font-weight="700">${title}</text>
      <text x="1868" y="1028" fill="#f4f0e8" text-anchor="end" font-size="18" letter-spacing="3">2025 — 2026</text>
      ${tileLabels}
    </g>
  </svg>`;
}

async function run(args, allowProbe = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-y", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (chunk) => { log = (log + chunk).slice(-18000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 || allowProbe ? resolve(log) : reject(new Error(log)));
  });
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : target;
  }));
  return nested.flat();
}

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, "src", "data", "archive");
const rawOutputRoot = path.join(outputRoot, "raw");
const mediaRoot = path.join(projectRoot, "public", "archive", "games");
const sourceRepository = "https://github.com/gammaruforever/gammaruforever.github.io";
const sourceBranch = "main";
const sourceBase = `https://raw.githubusercontent.com/gammaruforever/gammaruforever.github.io/${sourceBranch}`;
const localSource = process.env.GAMMARU_ARCHIVE_SOURCE?.trim();
const shouldDownloadMedia = process.argv.includes("--download-media");

const seasons = ["summer", "winter", "gamejam"];
const seasonCode = { summer: "su", winter: "wi", gamejam: "gj" };
const seasonLabel = { summer: "SUMMER", winter: "WINTER", gamejam: "GAME JAM" };

const sourceFiles = await discoverSourceFiles();
const slugRegistryPath = path.join(outputRoot, "slug-registry.json");
const previousSlugRegistry = await readJsonIfExists(slugRegistryPath, {});
const videoManifestPath = path.join(outputRoot, "video-manifest.json");
const videoManifest = await readJsonIfExists(videoManifestPath, {});
const slugRegistry = { ...previousSlugRegistry };
const games = [];
const mediaManifest = [];
const skipped = [];
const mediaErrors = [];

for (const sourcePath of sourceFiles) {
  const [, , yearText, fileName] = sourcePath.split("/");
  const year = Number(yearText);
  const season = fileName.replace(/\.json$/i, "");
  const records = await readSourceJson(sourcePath);
  const rawDirectory = path.join(rawOutputRoot, yearText);
  await mkdir(rawDirectory, { recursive: true });
  await writeFile(path.join(rawDirectory, fileName), `${JSON.stringify(records, null, 2)}\n`, "utf8");

  for (let sourceIndex = 0; sourceIndex < records.length; sourceIndex += 1) {
    const raw = records[sourceIndex] ?? {};
    if (isCompletelyBlank(raw)) {
      skipped.push({ sourcePath, sourceIndex, sourceId: raw.id ?? null, reason: "completely-blank" });
      continue;
    }

    const uid = `g-${year}-${seasonCode[season]}-${String(sourceIndex + 1).padStart(3, "0")}`;
    const rawTitle = cleanString(raw.title);
    const title = rawTitle || "제목 미상";
    const slug = slugRegistry[uid] || makeUniqueSlug(title, uid, Object.values(slugRegistry));
    slugRegistry[uid] = slug;
    const creators = parseCreators(raw.creator);
    const readme = await resolveReadme(year, raw.README);
    const award = normalizeAward(raw.rank);
    const download = normalizeDownload(raw.downloadUrl);
    const sourceMedia = [cleanString(raw.imageUrl), ...normalizeStringArray(raw.screenShots)].filter(Boolean);
    const media = {
      cover: null,
      screenshots: [],
      youtubeId: null,
      sourceUrls: sourceMedia,
    };

    if (shouldDownloadMedia) {
      const coverUrl = isRealImageUrl(raw.imageUrl) ? cleanString(raw.imageUrl) : "";
      const screenshotUrls = normalizeStringArray(raw.screenShots).filter(isRealImageUrl);
      if (coverUrl) {
        const result = await downloadImage(coverUrl, uid, "cover");
        if (result.ok) {
          media.cover = result.paths;
          mediaManifest.push(result.manifest);
        } else {
          mediaErrors.push(result.error);
        }
      }
      for (let index = 0; index < screenshotUrls.length; index += 1) {
        const result = await downloadImage(screenshotUrls[index], uid, `screenshot-${String(index + 1).padStart(2, "0")}`);
        if (result.ok) {
          media.screenshots.push(result.paths);
          mediaManifest.push(result.manifest);
        } else {
          mediaErrors.push(result.error);
        }
      }
    }

    games.push({
      uid,
      slug,
      year,
      season,
      seasonLabel: seasonLabel[season],
      sourceIndex,
      sourceId: raw.id ?? null,
      title,
      team: cleanString(raw.team) || null,
      creators,
      description: cleanString(raw.description) || null,
      genre: cleanString(raw.genre) || null,
      award,
      download,
      readme,
      media,
      source: {
        repository: sourceRepository,
        dataPath: sourcePath,
        contestUrl: `https://gammaruforever.github.io/games/${year}/${season}`,
        raw,
      },
    });
  }
}

games.sort((a, b) => b.year - a.year || seasonOrder(b.season) - seasonOrder(a.season) || a.sourceIndex - b.sourceIndex);

await mkdir(outputRoot, { recursive: true });
await writeJson(path.join(outputRoot, "games.json"), games);
await writeJson(slugRegistryPath, slugRegistry);
await writeJson(path.join(outputRoot, "media-manifest.json"), mediaManifest);
await writeJson(videoManifestPath, videoManifest);
await writeJson(path.join(outputRoot, "import-report.json"), {
  importedAt: new Date().toISOString(),
  sourceRepository,
  sourceBranch,
  sourceFiles,
  rawRecordCount: games.length + skipped.length,
  publishedRecordCount: games.length,
  skipped,
  media: {
    requested: shouldDownloadMedia,
    convertedCount: mediaManifest.length,
    errorCount: mediaErrors.length,
    errors: mediaErrors,
  },
});

console.log(`Imported ${games.length} games from ${sourceFiles.length} archive files.`);
console.log(`Skipped ${skipped.length} completely blank record(s).`);
console.log(`Converted ${mediaManifest.length} image(s); ${mediaErrors.length} media error(s).`);

async function discoverSourceFiles() {
  if (localSource) {
    const results = [];
    for (let year = 2016; year <= 2100; year += 1) {
      for (const season of seasons) {
        const relative = `public/data/${year}/${season}.json`;
        try {
          await readFile(path.join(localSource, relative));
          results.push(relative);
        } catch {}
      }
    }
    return results;
  }

  const response = await fetch(`https://api.github.com/repos/gammaruforever/gammaruforever.github.io/git/trees/${sourceBranch}?recursive=1`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "gammaru-archive-importer" },
  });
  if (!response.ok) throw new Error(`Archive tree request failed: ${response.status}`);
  const tree = await response.json();
  return tree.tree
    .map((entry) => entry.path)
    .filter((entryPath) => /^public\/data\/\d{4}\/(summer|winter|gamejam)\.json$/.test(entryPath))
    .sort();
}

async function readSourceJson(relativePath) {
  if (localSource) {
    return JSON.parse(await readFile(path.join(localSource, relativePath), "utf8"));
  }
  const response = await fetch(`${sourceBase}/${relativePath}`, { headers: { "User-Agent": "gammaru-archive-importer" } });
  if (!response.ok) throw new Error(`Archive data request failed: ${relativePath} (${response.status})`);
  return response.json();
}

async function resolveReadme(year, fileName) {
  const cleanName = cleanString(fileName);
  if (!cleanName) return { status: "missing", source: null, text: null };
  const relativePath = `public/data/${year}/README/${cleanName}`;
  try {
    let text;
    if (localSource) {
      text = await readFile(path.join(localSource, relativePath), "utf8");
    } else {
      const response = await fetch(`${sourceBase}/${relativePath}`, { headers: { "User-Agent": "gammaru-archive-importer" } });
      if (!response.ok) throw new Error(String(response.status));
      text = await response.text();
    }
    return { status: "available", source: relativePath, text: text.trim() || null };
  } catch {
    return { status: "broken", source: relativePath, text: null };
  }
}

async function downloadImage(url, uid, baseName) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "lh3.googleusercontent.com") {
      throw new Error("Image host is not allowlisted");
    }
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GammaruArchive/1.0)" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > 20 * 1024 * 1024) throw new Error("Image exceeds 20 MB limit");
    const input = Buffer.from(await response.arrayBuffer());
    if (input.byteLength > 20 * 1024 * 1024) throw new Error("Image exceeds 20 MB limit");
    const digest = createHash("sha256").update(input).digest("hex");
    const directory = path.join(mediaRoot, uid);
    await mkdir(directory, { recursive: true });
    const webpFile = `${baseName}.webp`;
    const avifFile = `${baseName}.avif`;
    await sharp(input).rotate().resize({ width: 1600, height: 1000, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(directory, webpFile));
    await sharp(input).rotate().resize({ width: 1600, height: 1000, fit: "inside", withoutEnlargement: true }).avif({ quality: 62 }).toFile(path.join(directory, avifFile));
    const prefix = `/archive/games/${uid}`;
    return {
      ok: true,
      paths: { webp: `${prefix}/${webpFile}`, avif: `${prefix}/${avifFile}` },
      manifest: { gameUid: uid, role: baseName, sourceUrl: url, sha256: digest, webp: `${prefix}/${webpFile}`, avif: `${prefix}/${avifFile}` },
    };
  } catch (error) {
    return { ok: false, error: { gameUid: uid, role: baseName, sourceUrl: url, message: String(error) } };
  }
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function parseCreators(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  const single = cleanString(value);
  return single ? single.split(/\s*,\s*|\s{2,}/).filter(Boolean) : [];
}

function isCompletelyBlank(raw) {
  return ![
    cleanString(raw.title),
    cleanString(raw.team),
    cleanString(raw.description),
    cleanString(raw.genre),
    cleanString(raw.imageUrl),
    cleanString(raw.downloadUrl),
    cleanString(raw.README),
    ...parseCreators(raw.creator),
    ...normalizeStringArray(raw.screenShots),
  ].some(Boolean);
}

function normalizeAward(rank) {
  const raw = typeof rank === "number" || typeof rank === "string" ? rank : 0;
  const key = String(raw).trim().toLowerCase();
  const labels = { "1": "1위", "2": "2위", "3": "3위", "4": "기록 4", "5": "기록 5", plan: "PLAN", dev: "DEV", pop: "POP" };
  return { raw, code: key === "0" || !key ? null : key, label: labels[key] ?? (key === "0" || !key ? null : `수상 기록 ${key}`) };
}

function normalizeDownload(value) {
  const raw = cleanString(value);
  if (!raw) return { raw: null, url: null, status: "missing" };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    return { raw, url: parsed.toString(), status: "available" };
  } catch {
    return { raw, url: null, status: "broken" };
  }
}

function isRealImageUrl(value) {
  const url = cleanString(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "lh3.googleusercontent.com";
  } catch {
    return false;
  }
}

function makeUniqueSlug(title, uid, existing) {
  const base = title
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "untitled";
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate === "untitled" ? `${candidate}-${uid}` : candidate;
}

function seasonOrder(value) {
  return value === "winter" ? 3 : value === "gamejam" ? 2 : 1;
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

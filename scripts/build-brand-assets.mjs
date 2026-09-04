import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const sourceLogo = path.join(projectRoot, "GammaruIcon.png");
const brandDirectory = path.join(projectRoot, "public", "brand");

await mkdir(brandDirectory, { recursive: true });

const trimmedLogo = await sharp(sourceLogo)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ width: 960, kernel: "nearest", withoutEnlargement: false })
  .png({ compressionLevel: 9 })
  .toBuffer();

await sharp(trimmedLogo)
  .resize({ width: 720, kernel: "nearest" })
  .png({ compressionLevel: 9 })
  .toFile(path.join(brandDirectory, "gammaru-logo.png"));

const logoMetadata = await sharp(sourceLogo).metadata();
const markLeft = Math.round((logoMetadata.width ?? 800) * 0.305);
const markTop = Math.round((logoMetadata.height ?? 600) * 0.218);
const markWidth = Math.round((logoMetadata.width ?? 800) * 0.39);
const markHeight = Math.round((logoMetadata.height ?? 600) * 0.385);

const markCrop = await sharp(sourceLogo)
  .extract({ left: markLeft, top: markTop, width: markWidth, height: markHeight })
  .png()
  .toBuffer();

await sharp(markCrop)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ width: 512, kernel: "nearest" })
  .png({ compressionLevel: 9 })
  .toFile(path.join(brandDirectory, "gammaru-mark.png"));

const logoData = trimmedLogo.toString("base64");
const markData = (await readFile(path.join(brandDirectory, "gammaru-mark.png"))).toString("base64");
const posterSvg = `
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect x="1" y="1" width="2" height="2" fill="#f4f0e8" opacity="0.09" />
    </pattern>
    <pattern id="micro" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="2" height="2" fill="#ef62bd" opacity="0.22" />
    </pattern>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#080918" />
      <stop offset="0.58" stop-color="#100818" />
      <stop offset="1" stop-color="#180a20" />
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#shade)" />
  <rect width="1920" height="1080" fill="url(#dots)" />
  <rect x="72" y="64" width="1776" height="952" fill="none" stroke="#39223e" stroke-width="2" />
  <path d="M72 186H410M1510 894H1848" stroke="#ef62bd" stroke-width="8" />
  <path d="M72 204H280M1640 876H1848" stroke="#b8ee63" stroke-width="4" />
  <g fill="url(#micro)" opacity="0.7">
    <rect x="116" y="116" width="176" height="64" />
    <rect x="1628" y="900" width="176" height="64" />
  </g>
  <image href="data:image/png;base64,${logoData}" x="900" y="250" width="900" height="560" preserveAspectRatio="xMidYMid meet" />
  <rect x="112" y="900" width="280" height="6" fill="#ef62bd" />
  <rect x="392" y="900" width="120" height="6" fill="#b8ee63" />
</svg>`;

const poster = sharp(Buffer.from(posterSvg));
await poster.clone().webp({ quality: 92 }).toFile(path.join(brandDirectory, "hero-end-frame.webp"));
await poster.clone().avif({ quality: 74 }).toFile(path.join(brandDirectory, "hero-end-frame.avif"));
await poster.png({ compressionLevel: 9 }).toFile(path.join(brandDirectory, "hero-end-frame.png"));

const mobilePosterSvg = `
<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <rect x="1" y="1" width="2" height="2" fill="#f4f0e8" opacity="0.09" />
    </pattern>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#080918" />
      <stop offset="1" stop-color="#180a20" />
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#shade)" />
  <rect width="1080" height="1920" fill="url(#dots)" />
  <rect x="54" y="54" width="972" height="1812" fill="none" stroke="#39223e" stroke-width="2" />
  <path d="M54 190H330M760 1728H1026" stroke="#ef62bd" stroke-width="8" />
  <path d="M54 208H230M870 1710H1026" stroke="#b8ee63" stroke-width="4" />
  <image href="data:image/png;base64,${markData}" x="400" y="1050" width="720" height="560" preserveAspectRatio="xMidYMid meet" />
</svg>`;

const mobilePoster = sharp(Buffer.from(mobilePosterSvg));
await mobilePoster.clone().webp({ quality: 92 }).toFile(path.join(brandDirectory, "hero-end-frame-mobile.webp"));
await mobilePoster.clone().avif({ quality: 74 }).toFile(path.join(brandDirectory, "hero-end-frame-mobile.avif"));

const outputs = await Promise.all(
  ["gammaru-logo.png", "gammaru-mark.png", "hero-end-frame.webp", "hero-end-frame.avif", "hero-end-frame.png", "hero-end-frame-mobile.webp", "hero-end-frame-mobile.avif"].map(async (file) => {
    const buffer = await readFile(path.join(brandDirectory, file));
    return `${file}: ${buffer.byteLength} bytes`;
  }),
);

console.log(outputs.join("\n"));

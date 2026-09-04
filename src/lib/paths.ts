export const publicSiteUrl = "https://kgr0831.github.io/Gammarupage";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function assetPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${publicBasePath}${path}`;
}

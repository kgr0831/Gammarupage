export const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gammarupage.vercel.app";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function assetPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${publicBasePath}${path}`;
}

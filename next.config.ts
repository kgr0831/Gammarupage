import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "Gammarupage";
const basePath = isGitHubPages ? `/${repositoryName}` : "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  output: isGitHubPages ? "export" : undefined,
  trailingSlash: isGitHubPages,
  basePath,
  ...(isGitHubPages ? {} : {
    async headers() {
      return [{
        source: "/media/reel/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      }];
    },
  }),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    unoptimized: isGitHubPages,
  },
};

export default nextConfig;

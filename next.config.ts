import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.REPORTS_DEPLOY_TARGET === "aws" ? "standalone" : undefined,
  allowedDevOrigins: ["127.0.0.1"],
  // AWS and Vercel both retain authenticated request-time report routes.
  outputFileTracingIncludes: {
    "/reports/**": ["./funding/portal/style.css", "./Design.md", "./gammaruInfo.md", "./docs/dots-daily-brief.md", "./docs/personal-brief-profile.md", "./docs/dots-personal-brief.md", "./docs/personal-Design.md"],
    "/personal/**": ["./funding/portal/style.css", "./docs/personal-brief-profile.md", "./docs/dots-personal-brief.md", "./docs/personal-Design.md"],
  },
  outputFileTracingExcludes: {
    "/**": [".env*", "funding/data/**", "funding/.codex/**", "test-results/**"],
  },
  async headers() {
    return [{
      source: "/media/reel/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
  async redirects() {
    return process.env.REPORTS_SERVICE === "personal"
      ? [{ source: "/", destination: "/reports", permanent: false }]
      : [];
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: "",
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;

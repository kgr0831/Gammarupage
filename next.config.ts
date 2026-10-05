import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  // The live site is on Vercel. Authenticated HTML uploads need request-time routes.
  outputFileTracingIncludes: {
    "/reports/**": ["./funding/portal/style.css", "./Design.md", "./gammaruInfo.md"],
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
  env: {
    NEXT_PUBLIC_BASE_PATH: "",
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;

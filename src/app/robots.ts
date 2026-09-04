import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/lib/paths";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${publicSiteUrl}/sitemap.xml` };
}

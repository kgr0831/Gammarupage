import type { MetadataRoute } from "next";
import { archiveGames, getGamePath } from "@/data/archive";
import { publicSiteUrl } from "@/lib/paths";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const core = ["", "/games", "/activities", "/about", "/log"].map((route) => ({ url: `${publicSiteUrl}${route}` }));
  const games = archiveGames.map((game) => ({ url: `${publicSiteUrl}${getGamePath(game)}` }));
  return [...core, ...games];
}

import gamesJson from "./games.json";
import videoManifestJson from "./video-manifest.json";
import type { ArchiveGame, ArchiveSeason } from "@/types/archive";

export const archiveGames = gamesJson as ArchiveGame[];

export const videoManifest = videoManifestJson as Record<
  string,
  { youtubeId?: string; localVideo?: string; featured?: boolean }
>;

export const seasonNames: Record<ArchiveSeason, { ko: string; en: string }> = {
  summer: { ko: "여름 공모전", en: "SUMMER" },
  winter: { ko: "겨울 공모전", en: "WINTER" },
  gamejam: { ko: "게임잼", en: "GAME JAM" },
};

export const archiveYears = [...new Set(archiveGames.map((game) => game.year))].sort((a, b) => b - a);

export const archiveGenres = [...new Set(archiveGames.map((game) => game.genre).filter(Boolean) as string[])].sort(
  (a, b) => a.localeCompare(b, "ko"),
);

const featuredTitles = [
  "우리 집 고양이가 인간이 되었다?!",
  "SLab",
  "신출귀몰",
  "Cosmos Walker",
  "다모나",
  "발게임",
  "감금전문대학원",
  "I Wanna Be The Miner",
];

export const featuredGames = featuredTitles
  .map((title) => archiveGames.find((game) => game.title === title && game.media.cover))
  .filter((game): game is ArchiveGame => Boolean(game));

export function getGame(year: number, season: string, slug: string) {
  let decodedSlug = slug;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {}
  return archiveGames.find((game) => game.year === year && game.season === season && game.slug === decodedSlug);
}

export function getGamePath(game: Pick<ArchiveGame, "year" | "season" | "slug">) {
  return `/games/${game.year}/${game.season}/${game.slug}`;
}

export function withVideo(game: ArchiveGame): ArchiveGame {
  const video = videoManifest[game.uid];
  if (!video?.youtubeId) return game;
  return { ...game, media: { ...game.media, youtubeId: video.youtubeId } };
}

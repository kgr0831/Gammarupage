export type ArchiveSeason = "summer" | "winter" | "gamejam";

export type ArchiveImage = {
  webp: string;
  avif: string;
};

export type ArchiveGame = {
  uid: string;
  slug: string;
  year: number;
  season: ArchiveSeason;
  seasonLabel: string;
  sourceIndex: number;
  sourceId: number | string | null;
  title: string;
  team: string | null;
  creators: string[];
  description: string | null;
  genre: string | null;
  award: {
    raw: number | string;
    code: string | null;
    label: string | null;
  };
  download: {
    raw: string | null;
    url: string | null;
    status: "available" | "missing" | "broken";
  };
  readme: {
    status: "available" | "missing" | "broken";
    source: string | null;
    text: string | null;
  };
  media: {
    cover: ArchiveImage | null;
    screenshots: ArchiveImage[];
    youtubeId: string | null;
    sourceUrls: string[];
  };
  source: {
    repository: string;
    dataPath: string;
    contestUrl: string;
    raw: Record<string, unknown>;
  };
};

export type GameSummary = Pick<
  ArchiveGame,
  "uid" | "slug" | "year" | "season" | "seasonLabel" | "sourceIndex" | "title" | "team" | "genre" | "award" | "media"
>;

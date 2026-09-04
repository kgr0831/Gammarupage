import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArchiveExplorer } from "@/components/ArchiveExplorer";
import { archiveGames, archiveGenres, archiveYears, seasonNames } from "@/data/archive";
import type { ArchiveSeason, GameSummary } from "@/types/archive";

const validSeasons = new Set(["summer", "winter", "gamejam"]);

export async function generateStaticParams() {
  return [...new Set(archiveGames.map((game) => `${game.year}:${game.season}`))].map((key) => {
    const [year, season] = key.split(":");
    return { year, season };
  });
}

export async function generateMetadata({ params }: { params: Promise<{ year: string; season: string }> }): Promise<Metadata> {
  const { year, season } = await params;
  if (!validSeasons.has(season)) return {};
  return { title: `${year} ${seasonNames[season as ArchiveSeason].en} Games` };
}

export default async function SeasonGamesPage({ params }: { params: Promise<{ year: string; season: string }> }) {
  const { year: yearText, season } = await params;
  const year = Number(yearText);
  if (!Number.isInteger(year) || !validSeasons.has(season)) notFound();
  const seasonGames = archiveGames.filter((game) => game.year === year && game.season === season);
  if (!seasonGames.length) notFound();
  const name = seasonNames[season as ArchiveSeason];
  return (
    <div className="page-shell archive-page">
      <header className="page-hero page-hero--compact">
        <h1>{year}<span>.</span></h1>
        <div className="page-hero__aside"><strong>{String(seasonGames.length).padStart(2, "0")}</strong><p>{name.ko}<br />출품작 아카이브</p></div>
      </header>
      <ArchiveExplorer
        games={archiveGames as GameSummary[]}
        years={archiveYears}
        genres={archiveGenres}
        initialYear={year}
        initialSeason={season as ArchiveSeason}
      />
    </div>
  );
}

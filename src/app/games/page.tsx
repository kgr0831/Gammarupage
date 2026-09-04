import type { Metadata } from "next";
import { ArchiveExplorer } from "@/components/ArchiveExplorer";
import { archiveGames, archiveGenres, archiveYears } from "@/data/archive";
import type { GameSummary } from "@/types/archive";

export const metadata: Metadata = {
  title: "Games",
  description: "겜마루의 역대 공모전 및 게임잼 작품 아카이브",
};

export default function GamesPage() {
  const summaries = archiveGames as GameSummary[];
  return (
    <div className="page-shell archive-page">
      <header className="page-hero">
        <h1>GAMES<span>.</span></h1>
        <div className="page-hero__aside">
          <strong>{String(archiveGames.length).padStart(3, "0")}</strong>
          <p>역대 공모전과 게임잼 작품</p>
        </div>
      </header>
      <ArchiveExplorer games={summaries} years={archiveYears} genres={archiveGenres} />
    </div>
  );
}

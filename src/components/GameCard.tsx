import Link from "next/link";
import { getGamePath } from "@/data/archive";
import type { GameSummary } from "@/types/archive";
import { GameVisual } from "./GameVisual";

export function GameCard({ game, index = 0 }: { game: GameSummary; index?: number }) {
  return (
    <Link href={getGamePath(game)} className="game-card" style={{ "--card-index": index } as React.CSSProperties}>
      <div className="game-card__visual">
        <GameVisual image={game.media.cover} title={game.title} />
        <span className="game-card__scan" aria-hidden="true" />
        <span className="game-card__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        {game.award.code && <span className="game-card__award">{game.award.label}</span>}
      </div>
      <div className="game-card__meta">
        <span>{game.year} / {game.seasonLabel}</span>
        <span>{game.genre || "자료 정리 중"}</span>
      </div>
      <h3>{game.title}</h3>
      <div className="game-card__team">
        <span>{game.team || "팀명 자료 정리 중"}</span>
      </div>
    </Link>
  );
}

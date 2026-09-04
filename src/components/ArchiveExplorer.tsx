"use client";

import { useMemo, useState } from "react";
import type { ArchiveSeason, GameSummary } from "@/types/archive";
import { GameCard } from "./GameCard";

type SortOrder = "newest" | "oldest";

export function ArchiveExplorer({
  games,
  years,
  genres,
  initialYear = "all",
  initialSeason = "all",
}: {
  games: GameSummary[];
  years: number[];
  genres: string[];
  initialYear?: number | "all";
  initialSeason?: ArchiveSeason | "all";
}) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(String(initialYear));
  const [season, setSeason] = useState(String(initialSeason));
  const [genre, setGenre] = useState("all");
  const [awardOnly, setAwardOnly] = useState(false);
  const [sort, setSort] = useState<SortOrder>("newest");
  const [visibleCount, setVisibleCount] = useState(24);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ko-KR");
    return games
      .filter((game) => year === "all" || game.year === Number(year))
      .filter((game) => season === "all" || game.season === season)
      .filter((game) => genre === "all" || game.genre === genre)
      .filter((game) => !awardOnly || Boolean(game.award.code))
      .filter((game) => !needle || `${game.title} ${game.team || ""}`.toLocaleLowerCase("ko-KR").includes(needle))
      .sort((a, b) => {
        const direction = sort === "newest" ? -1 : 1;
        return (a.year - b.year) * direction || a.sourceIndex - b.sourceIndex;
      });
  }, [awardOnly, games, genre, query, season, sort, year]);

  const resetWindow = () => setVisibleCount(24);
  const update = (setter: (value: string) => void, value: string) => {
    setter(value);
    resetWindow();
  };

  return (
    <section className="archive-explorer" aria-label="게임 아카이브 검색">
      <div className="archive-controls">
        <label className="archive-search">
          <span>검색</span>
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); resetWindow(); }}
            placeholder="제목 또는 팀명"
            type="search"
          />
        </label>
        <label>
          <span>연도</span>
          <select value={year} onChange={(event) => update(setYear, event.target.value)}>
            <option value="all">전체</option>
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>시즌</span>
          <select value={season} onChange={(event) => update(setSeason, event.target.value)}>
            <option value="all">전체</option>
            <option value="summer">여름 공모전</option>
            <option value="winter">겨울 공모전</option>
            <option value="gamejam">게임잼</option>
          </select>
        </label>
        <label>
          <span>장르</span>
          <select value={genre} onChange={(event) => update(setGenre, event.target.value)}>
            <option value="all">전체</option>
            {genres.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>정렬</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
            <option value="newest">최신순</option>
            <option value="oldest">오래된순</option>
          </select>
        </label>
        <button
          type="button"
          aria-pressed={awardOnly}
          className={`award-toggle${awardOnly ? " award-toggle--active" : ""}`}
          onClick={() => { setAwardOnly((value) => !value); resetWindow(); }}
        >
          <span>수상작만</span>
          {awardOnly ? "켜짐" : "꺼짐"}
        </button>
      </div>
      <div className="archive-count" aria-live="polite">
        <span>{filtered.length}</span>개 작품
      </div>
      {filtered.length ? (
        <>
          <div className="game-grid">
            {filtered.slice(0, visibleCount).map((game, index) => <GameCard key={game.uid} game={game} index={index} />)}
          </div>
          {visibleCount < filtered.length && (
            <button className="load-more" type="button" onClick={() => setVisibleCount((value) => value + 24)}>
              작품 더 보기
            </button>
          )}
        </>
      ) : (
        <div className="archive-empty">
          <strong>작품을 찾을 수 없습니다.</strong>
          <p>검색 조건을 다시 조정해 주세요.</p>
        </div>
      )}
    </section>
  );
}

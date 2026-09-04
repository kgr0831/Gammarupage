import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameCard } from "@/components/GameCard";
import { GameVisual } from "@/components/GameVisual";
import { archiveGames, getGame, getGamePath, seasonNames, withVideo } from "@/data/archive";
import { assetPath } from "@/lib/paths";

export function generateStaticParams() {
  return archiveGames.map((game) => ({ year: String(game.year), season: game.season, slug: game.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ year: string; season: string; slug: string }> }): Promise<Metadata> {
  const { year, season, slug } = await params;
  const game = getGame(Number(year), season, slug);
  if (!game) return {};
  return { title: game.title, description: game.description || `${game.year} ${seasonNames[game.season].ko} 출품작` };
}

export default async function GameDetailPage({ params }: { params: Promise<{ year: string; season: string; slug: string }> }) {
  const { year, season, slug } = await params;
  const found = getGame(Number(year), season, slug);
  if (!found) notFound();
  const game = withVideo(found);
  const related = archiveGames
    .filter((item) => item.uid !== game.uid && item.year === game.year && item.season === game.season)
    .slice(0, 3);

  return (
    <article className="game-detail page-shell">
      <nav className="breadcrumbs" aria-label="현재 위치">
        <Link href="/games">GAMES</Link><span>/</span>
        <Link href={`/games/${game.year}/${game.season}`}>{game.year} {game.seasonLabel}</Link><span>/</span>
        <span aria-current="page">{game.title}</span>
      </nav>
      <header className="game-detail__hero">
        <div className="game-detail__copy">
          <p className="page-code">{game.year} / {game.seasonLabel}</p>
          {game.award.code && <span className="detail-award">수상 기록 / {game.award.label}</span>}
          <h1 className={game.title.length > 18 ? "game-detail__long-title" : undefined}>{game.title}</h1>
          <p className="game-detail__team">{game.team || "팀명 자료 정리 중"}</p>
          <div className="game-detail__facts">
            <div><span>GENRE</span><strong>{game.genre || "자료 정리 중"}</strong></div>
            <div><span>SEASON</span><strong>{seasonNames[game.season].ko}</strong></div>
            <div><span>YEAR</span><strong>{game.year}</strong></div>
          </div>
          {game.download.status === "available" && game.download.url ? (
            <a className="pixel-button pixel-button--lime" href={game.download.url} target="_blank" rel="noreferrer">게임 다운로드</a>
          ) : (
            <span className="pixel-button pixel-button--disabled" aria-disabled="true">
              {game.download.status === "broken" ? "다운로드 불가" : "파일 없음"}
            </span>
          )}
        </div>
        <div className="game-detail__cover"><GameVisual image={game.media.cover} title={game.title} eager /></div>
      </header>

      <section className="detail-section">
        <p className="eyebrow">작품 소개</p>
        <div className="detail-copy-grid">
          <h2>{game.description || "자료 정리 중입니다."}</h2>
          <div>
            <span>제작</span>
            <p>{game.creators.length ? game.creators.join(" · ") : "제작자 정보 정리 중"}</p>
          </div>
        </div>
      </section>

      {game.media.youtubeId && (
        <section className="detail-section">
          <p className="eyebrow">플레이 영상</p>
          <div className="video-frame">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${game.media.youtubeId}`}
              title={`${game.title} 플레이 영상`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </section>
      )}

      {game.media.screenshots.length > 0 && (
        <section className="detail-section">
          <p className="eyebrow">스크린샷</p>
          <div className="screenshot-grid">
            {game.media.screenshots.map((image, index) => (
              <picture key={image.webp}>
                <source srcSet={assetPath(image.avif)} type="image/avif" />
                <img src={assetPath(image.webp)} alt={`${game.title} 스크린샷 ${index + 1}`} loading="lazy" />
              </picture>
            ))}
          </div>
        </section>
      )}

      {game.readme.text && (
        <section className="detail-section">
          <p className="eyebrow">README</p>
          <pre className="readme-block">{game.readme.text}</pre>
        </section>
      )}

      <section className="detail-source">
        <span>출처</span>
        <a href={game.source.contestUrl} target="_blank" rel="noreferrer">기존 공개 아카이브</a>
      </section>

      {related.length > 0 && (
        <section className="related-games">
          <div className="related-games__heading"><p className="eyebrow">같은 시즌</p><Link href={`/games/${game.year}/${game.season}`}>전체 보기</Link></div>
          <div className="game-grid game-grid--related">{related.map((item, index) => <GameCard key={item.uid} game={item} index={index} />)}</div>
        </section>
      )}
      <Link className="back-link" href={getGamePath(game).split("/").slice(0, -1).join("/")}>시즌 목록으로</Link>
    </article>
  );
}

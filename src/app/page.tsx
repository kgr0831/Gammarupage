import Link from "next/link";
import { GameCard } from "@/components/GameCard";
import { HeroReel } from "@/components/HeroReel";
import { RoleDeck } from "@/components/RoleDeck";
import { SectionHeading } from "@/components/SectionHeading";
import { archiveGames, featuredGames } from "@/data/archive";
import { activities, logEntries, siteConfig } from "@/data/site";

export default function Home() {
  const seasonCount = new Set(archiveGames.map((game) => `${game.year}-${game.season}`)).size;

  return (
    <div className="home-page">
      <HeroReel />
      <section className="hero">
        <div className="hero__frame" aria-hidden="true">
          <span className="hero__corner hero__corner--tl" />
          <span className="hero__corner hero__corner--tr" />
          <span className="hero__corner hero__corner--bl" />
          <span className="hero__corner hero__corner--br" />
        </div>
        <div className="hero__copy">
          <h1>
            <span>THE BUILD</span>
            <span>IS OUR</span>
            <span><em>INTRODUCTION.</em></span>
          </h1>
          <p className="hero__subtitle">{siteConfig.hero.subtitle}</p>
          <div className="hero__actions">
            <Link className="pixel-button pixel-button--primary" href="/games">
              GAMES
            </Link>
            <Link className="text-link" href="/about">ABOUT</Link>
          </div>
        </div>
        <div className="hero__stats" aria-label="공개 아카이브 요약">
          <div><strong>{archiveGames.length}</strong><span>공개 게임</span></div>
          <div><strong>{seasonCount}</strong><span>기록된 시즌</span></div>
          <div><strong>1995</strong><span>SINCE</span></div>
        </div>
      </section>

      <section className="section section--games">
        <SectionHeading
          eyebrow="GAMES / 게임"
          title="먼저, 만든 게임부터."
        />
        <div className="featured-grid">
          {featuredGames.slice(0, 6).map((game, index) => <GameCard key={game.uid} game={game} index={index} />)}
        </div>
        <div className="section-tail reveal">
          <span>전체 {archiveGames.length}개 작품</span>
          <Link href="/games" className="pixel-button">전체 게임 보기</Link>
        </div>
      </section>

      <section className="section section--roles">
        <SectionHeading
          eyebrow="ROLES / 역할"
          title="각자의 파트가 하나의 게임이 됩니다."
        />
        <RoleDeck />
      </section>

      <section className="section section--activity">
        <SectionHeading
          eyebrow="ACTIVITIES / 활동"
          title="게임을 만드는 과정."
        />
        <div className="activity-ledger">
          {activities.map((activity, index) => (
            <article className="activity-row reveal" key={activity.id} style={{ "--row-index": index } as React.CSSProperties}>
              <span className="activity-row__id">{activity.id}</span>
              <div><p>{activity.en}</p><h3>{activity.ko}</h3></div>
              <p className="activity-row__summary">{activity.summary}</p>
            </article>
          ))}
        </div>
        <Link href="/activities" className="text-link section-link">활동 더 보기</Link>
      </section>

      <section className="history-slice">
        <div className="history-slice__year reveal">1995</div>
        <div className="history-slice__copy reveal">
          <h2>게임을 만들고 싶은 사람들이<br />편하게 모일 수 있는 마루.</h2>
          <p>겜마루는 숭실대학교에서 기획, 아트, 프로그래밍, 사운드를 잇고 실제 게임을 완성해 온 게임 제작 중앙동아리입니다.</p>
          <Link className="text-link" href="/about">겜마루 소개</Link>
        </div>
      </section>

      <section className="status-panel reveal">
        <div className="status-panel__light" aria-hidden="true" />
        <div>
          <h2>PARTY FORMATION<br />COMPLETE</h2>
        </div>
        <div className="status-panel__copy">
          <p>이번 시즌의 파티 구성이 완료되었습니다.<br />다음 합류 기회를 노려보세요.</p>
          <Link href="/log" className="pixel-button pixel-button--lime">다음 모집 확인</Link>
        </div>
      </section>

      <section className="section section--log">
        <SectionHeading eyebrow="LOG / 기록" title="최근 활동." />
        <div className="log-list">
          {logEntries.slice(0, 3).map((entry) => (
            <article className="log-row reveal" key={`${entry.date}-${entry.title}`}>
              <time>{entry.date}</time><span>{entry.type}</span><h3>{entry.title}</h3><p>{entry.description}</p>
            </article>
          ))}
        </div>
        <Link href="/log" className="text-link section-link">전체 기록 보기</Link>
      </section>
    </div>
  );
}

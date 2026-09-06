import type { Metadata } from "next";
import Image from "next/image";
import { activities } from "@/data/site";

export const metadata: Metadata = {
  title: "Activities",
  description: "공모전, 게임잼, 스터디와 네트워킹으로 이어지는 겜마루의 활동",
};

const publicVideos = [
  {
    id: "53zumMf-5As",
    label: "WINTER CONTEST",
    title: "겨울공모전 출품작",
    href: "https://youtu.be/53zumMf-5As",
  },
  {
    id: "4CrZ-eK8K1c",
    label: "2025 GAME JAM",
    title: "2025 게임잼 출품작",
    href: "https://youtu.be/4CrZ-eK8K1c",
  },
];

export default function ActivitiesPage() {
  return (
    <div className="page-shell activity-page">
      <header className="page-hero page-hero--long">
        <h1>ACTIVITIES<span>.</span></h1>
        <div className="page-hero__aside page-hero__aside--copy"><p>공모전, 게임잼, 스터디와 교류</p></div>
      </header>

      <section className="process-line" aria-label="겜마루 활동 과정">
        <div className="process-line__rail" aria-hidden="true" />
        {activities.map((activity) => (
          <article key={activity.id} className="process-step reveal">
            <div className="process-step__marker"><span>{activity.id}</span></div>
            <div className="process-step__title">
              <p className="eyebrow">{activity.en}</p>
              <h2>{activity.ko}</h2>
            </div>
            <p>{activity.summary}</p>
          </article>
        ))}
      </section>

      <section className="activity-note-grid">
        <article className="activity-note reveal">
          <p className="eyebrow">STUDY / 2025</p>
          <h2>서로의 지식이<br />동아리의 다음 빌드가 됩니다.</h2>
          <p>Unity, Unreal, Ren&apos;Py, 일러스트, 게임 수학, 기획, 픽셀 아트까지 일곱 분야의 스터디가 진행되었습니다.</p>
        </article>
        <article className="activity-note activity-note--lime reveal">
          <p className="eyebrow">업계 교류</p>
          <h2>교내에서 만들고,<br />업계와 연결합니다.</h2>
          <p>배터그라운드와 OBYB 네트워킹을 통해 프로젝트 발표, 현직자 피드백, 진로 멘토링과 교류 세션을 경험했습니다.</p>
        </article>
      </section>

      <section className="media-ledger">
        <div className="media-ledger__heading">
          <p className="eyebrow">VIDEOS / 영상</p>
          <h2>공모전과 게임잼.</h2>
        </div>
        <div className="media-ledger__items">
          {publicVideos.map((video, index) => (
            <a className="video-poster reveal" href={video.href} target="_blank" rel="noreferrer" key={video.id}>
              {/* Fetch directly from YouTube without Vercel image transformations. */}
              <Image
                className="video-poster__image"
                src={`https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`}
                alt=""
                fill
                unoptimized
                loading="lazy"
                sizes="(max-width: 760px) 100vw, 50vw"
              />
              <span className="video-poster__number">0{index + 1}</span>
              <div className="video-poster__play" aria-hidden="true">▶</div>
              <div className="video-poster__caption"><p>{video.label}</p><h3>{video.title}</h3></div>
            </a>
          ))}
        </div>
      </section>

    </div>
  );
}

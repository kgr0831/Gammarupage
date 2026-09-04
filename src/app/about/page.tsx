import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { RoleDeck } from "@/components/RoleDeck";
import { assetPath } from "@/lib/paths";

export const metadata: Metadata = {
  title: "About",
  description: "1995년부터 이어진 숭실대학교 게임 제작 중앙동아리 겜마루 소개",
};

const faqs = [
  {
    question: "게임 개발을 해본 적이 없어도 괜찮나요?",
    answer: "괜찮습니다. 함께 공부하고 실제 제작 과정에 참여하려는 마음이 있다면 스터디와 팀 활동을 통해 시작할 수 있습니다.",
  },
  {
    question: "소프트웨어 관련 전공이 아니어도 참여할 수 있나요?",
    answer: "가능합니다. 겜마루는 학과와 학년을 가리지 않고 게임 개발에 관심 있는 숭실대학교 학생이 함께합니다.",
  },
  {
    question: "코딩을 할 줄 몰라도 되나요?",
    answer: "게임은 프로그래밍만으로 만들어지지 않습니다. 기획, 아트, 사운드 등 다양한 역할로 제작에 참여할 수 있습니다.",
  },
  {
    question: "지금 바로 지원할 수 있나요?",
    answer: "현재는 모집 기간이 아닙니다. 다음 모집 안내는 LOG와 공식 SNS에서 공개할 예정입니다.",
  },
];

export default function AboutPage() {
  return (
    <div className="page-shell about-page">
      <header className="page-hero">
        <h1>ABOUT<span>.</span></h1>
        <div className="page-hero__aside page-hero__aside--copy"><p>숭실대학교 게임 제작 중앙동아리<br />SINCE 1995</p></div>
      </header>

      <section className="about-intro">
        <div className="about-intro__logo reveal">
          <Image src={assetPath("/brand/gammaru-logo.png")} alt="겜마루" width={720} height={419} priority />
          <span className="pixel-mask" aria-hidden="true" />
        </div>
        <div className="about-intro__copy reveal">
          <p className="eyebrow">GAME + MARU</p>
          <h2>게임을 만들고 싶은 사람들이<br />편하게 모일 수 있는 마루.</h2>
          <p>겜마루는 1995년에 시작된 숭실대학교 게임 제작 중앙동아리입니다. 서로 다른 전공과 경험을 가진 학생들이 기획, 아트, 프로그래밍, 사운드로 만나 한 시즌의 아이디어를 플레이 가능한 게임으로 완성합니다.</p>
        </div>
      </section>

      <section className="about-roles">
        <div className="about-roles__heading reveal"><p className="eyebrow">ROLES / 역할</p><h2>다른 역할.<br />하나의 게임.</h2></div>
        <RoleDeck />
      </section>

      <section className="history-track">
        <p className="eyebrow">HISTORY / 연혁</p>
        <div className="history-track__line" aria-hidden="true" />
        <article className="reveal"><strong>1995</strong><div><h3>시작</h3><p>아마추어 게임 제작을 목적으로 겜마루가 시작되었습니다.</p></div></article>
        <article className="reveal"><strong>2023</strong><div><h3>교류</h3><p>대학생 게임 제작 교류 행사 SIGN에서 작품을 발표하고 피드백을 나눴습니다.</p></div></article>
        <article className="reveal"><strong>현재</strong><div><h3>제작 중</h3><p>공모전, 게임잼, 스터디와 네트워킹을 이어가며 다음 게임을 만들고 있습니다.</p></div></article>
      </section>

      <section className="faq-section">
        <div className="faq-section__heading">
          <p className="eyebrow">FAQ</p>
          <h2><span>처음 시작하는 사람도</span><span>한 팀이 될 수 있습니다.</span></h2>
        </div>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <details key={faq.question} className="faq-item reveal">
              <summary><span>0{index + 1}</span>{faq.question}<i aria-hidden="true">+</i></summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="about-exit reveal">
        <p>THE BUILD IS OUR INTRODUCTION.</p>
        <Link href="/games" className="pixel-button pixel-button--primary">게임 보기</Link>
      </section>
    </div>
  );
}

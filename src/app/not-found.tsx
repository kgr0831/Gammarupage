import Link from "next/link";

export default function NotFound() {
  return (
    <div className="not-found page-shell">
      <h1>404<span>.</span></h1>
      <p>페이지를 찾을 수 없습니다.</p>
      <Link className="pixel-button pixel-button--primary" href="/games">게임으로 돌아가기</Link>
    </div>
  );
}

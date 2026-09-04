# GAMMARU Landing

숭실대학교 게임 제작 중앙동아리 겜마루의 랜딩페이지와 공개 게임 아카이브입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## 관리 위치

- 공식 SNS 주소: `src/data/site.ts`의 `siteConfig.social`
- 활동과 공개 기록: `src/data/site.ts`
- 작품별 YouTube: `src/data/archive/video-manifest.json`
- 메인 쇼릴: `public/media/hero-reel.webm` 또는 `public/media/hero-reel.mp4`
- 쇼릴 원본 선택 및 재생성: `scripts/build-hero-reel.mjs`
- 쇼릴 편집 규칙: `public/media/README.md`

작품별 YouTube 연결 예시:

```json
{
  "g-2025-su-001": { "youtubeId": "YouTube video id" }
}
```

## 아카이브 갱신

```bash
npm run import:archive
```

공개 아카이브의 JSON을 다시 가져와 정규화하고, 허용된 게임 이미지만 로컬 WebP/AVIF로 변환합니다. 완전히 빈 레코드는 제외하며 기존 slug와 수동 YouTube 매핑은 유지합니다.

## 쇼릴 재생성

`GameVideo` 폴더가 로컬에 있을 때 아래 명령으로 1080p 무음 MP4/WebM을 다시 만들 수 있습니다.

```bash
npm run assets:reel
```

원본 영상 폴더는 저장소에서 제외되며, 사이트가 실제로 재생하는 편집본과 사용 구간 명세만 버전 관리합니다.

## 검증

```bash
npm run typecheck
npm run lint
npm run build
npm run test:smoke -- http://127.0.0.1:3000
```

GitHub Pages용 정적 결과물은 Actions 환경과 같은 경로로 확인할 수 있습니다.

```bash
GITHUB_ACTIONS=true GITHUB_REPOSITORY=kgr0831/Gammarupage npm run build
npm run preview:pages
npm run test:smoke -- http://127.0.0.1:4173/Gammarupage
```

`main` 브랜치에 반영되면 GitHub Actions가 `https://kgr0831.github.io/Gammarupage/`로 배포합니다.
빌드 후처리는 GitHub Pages의 정적 파일 규칙에서도 Next.js 탭 이동과 프리페치가 유지되도록 클라이언트 탐색 파일 별칭을 함께 생성합니다.

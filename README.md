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
- 영상 캡처 이미지: `src/data/archive/video-stills.json` (기존 이미지가 없을 때 사용)
- 캡처 원본·게임 UID·시점: `scripts/video-stills.config.json`
- 메인 쇼릴: `public/media/reel/<콘텐츠 해시>/` (HLS 분할 영상)
- 쇼릴 경로 및 편집 명세: `src/data/hero-reel-manifest.json`
- 쇼릴 게임·팀·참여자·공모전 자막 매칭: `src/data/hero-reel-game-ids.json` (같은 제목의 다른 시즌을 구분하는 게임 UID)
- 쇼릴 원본 선택 및 편집: `scripts/build-reel-preview.mjs`
- 배포용 인코딩 및 분할: `scripts/package-hero-reel.mjs`
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

영상 캡처는 `GameVideo` 원본 폴더가 있는 로컬에서 `npm run assets:game-stills`로 생성합니다. 설정의 첫 번째 시점은 대표 이미지, 나머지는 상세 스크린샷입니다. 제목과 UID를 검증하고 정확히 일치하는 원본 파일에서 캡처하며, 기존 대표 이미지는 유지합니다. WebP·AVIF를 미리 생성하므로 사이트에서 영상 다운로드나 서버 이미지 변환이 필요하지 않습니다. 생성된 `public/archive/video-stills/`와 매니페스트를 함께 반영합니다. 캡처 매니페스트는 아카이브 재수집과 별도로 유지됩니다.

## 쇼릴 재생성

`GameVideo` 폴더가 로컬에 있을 때 아래 명령으로 무음 반복 영상과 540p/1080p AV1·H.264 HLS를 다시 만들 수 있습니다. 인코딩은 로컬에서 수행하며 Vercel 빌드에서는 이미 생성된 파일을 사용합니다.

```bash
npm run assets:reel
```

편집된 `test-results/reel-v2/gammaru-reel-v2.mp4`와 `manifest.json`, `poster.jpg`가 있다면 `npm run assets:reel:package`로 배포 파일만 생성할 수 있습니다. 편집 미리보기는 `npm run preview:reel` 실행 후 `http://127.0.0.1:3188`에서 확인합니다. 미리보기용 단일 AV1 파일은 선택적으로 `node scripts/build-reel-preview.mjs --av1`로 생성합니다.

원본 영상 폴더는 저장소에서 제외되며, 사이트가 실제로 재생하는 편집본과 사용 구간 명세만 버전 관리합니다.

## 검증

```bash
npm run typecheck
npm run lint
npm run build
npm run test:smoke -- http://127.0.0.1:3000
npm run test:reel -- http://127.0.0.1:3000
npm run test:details -- http://127.0.0.1:3000
```

GitHub Pages용 정적 결과물은 Actions 환경과 같은 경로로 확인할 수 있습니다.

```bash
GITHUB_ACTIONS=true GITHUB_REPOSITORY=kgr0831/Gammarupage npm run build
npm run preview:pages
npm run test:smoke -- http://127.0.0.1:4173/Gammarupage
```

`main` 브랜치에 반영되면 GitHub Actions가 `https://kgr0831.github.io/Gammarupage/`로 배포합니다.
빌드 후처리는 GitHub Pages의 정적 파일 규칙에서도 Next.js 탭 이동과 프리페치가 유지되도록 클라이언트 탐색 파일 별칭을 함께 생성합니다.

Vercel에서는 기본 `npm run build`를 사용합니다. 콘텐츠 해시가 포함된 영상 경로에 1년 immutable 캐시 헤더를 적용합니다. GitHub Pages의 캐시 정책은 플랫폼에서 관리하며 Next.js 헤더 설정은 적용되지 않습니다.

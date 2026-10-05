# GAMMARU Landing

숭실대학교 게임 제작 중앙동아리 겜마루의 랜딩페이지와 공개 게임 아카이브입니다.

현재 개발 목표는 [겜마루 운영 플랫폼 기획안](docs/gammaru-platform-plan.md)에 정리했습니다.

## 구독자 전용 데일리 브리프

기존 Vercel 사이트 **https://gammarupage.vercel.app/** 에 붙일 HTML 보고서 보관함을 추가했습니다. dots가 외부 후원·운영자금·유용한 정보를 조사하고 [Design.md](Design.md)를 따라 완성한 HTML을 올리는 방식입니다. 채용공고 수집이 아닙니다.

- `/reports/upload`: HTML 업로드 → 미리보기 → 등록
- `/reports`: 지금까지 올린 보고서 목록·검색
- `/reports/YYYY-MM-DD`: 날짜별 보고서와 전체 목록 링크
- `/reports/account`: Discord 로그인·구독 신청
- `/reports/admin`: 관리자 로그인 후 이름·Discord 프로필로 구독 승인

목록과 HTML 원문은 승인된 구독자만 열람하며, 공개 랜딩 메뉴에는 링크를 추가하지 않습니다. Discord 봇은 승인·수신 동의한 회원에게 보고서 주소 한 줄만 DM으로 보냅니다. Private Blob에 저장하므로 최초 기능 배포 후 매일 업로드할 때는 재배포하지 않습니다.

```bash
npm run reports:dev
```

로컬 `/reports` 실행에는 `.env.funding`의 개발용 저장소·로그인 설정이 필요합니다. [Vercel 연결 안내](docs/vercel-html-reports.md), [dots 예약 작업 지시문](docs/dots-daily-brief.md)을 참고하세요. **실제 저장소 연결·배포·Discord OAuth 연결·dots 예약은 아직 완료하지 않았습니다.**

## 기존 운영자금 탐색·승인 시제품

`funding/`에 별도 Node 서버와 HTML 대시보드가 있습니다. 기존 랜딩 페이지의 색상을 사용하며 Codex 우선 조사, 팩트챗 웹 검색 대체, 일일 리포트, 디스코드 링크 알림, 승인 후 문서 생성·이메일 발송을 제공합니다. 운영 데이터는 공개 사이트 빌드에 포함되지 않습니다.

```bash
npm run funding:preview
```

가상 데이터로 만든 읽기 전용 화면은 `http://127.0.0.1:4311`에서 볼 수 있습니다. [독립 시제품](funding/README.md)과 [이전 회원 포털](funding/portal/README.md)은 별도 상시 서버를 전제로 한 기록입니다. 팩트챗 자동 대체·외부 작업 승인·스크럼·랜딩 CMS는 현재 Vercel 보고서 경로에 연결되지 않았습니다.

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
- 직접 제공된 게임 이미지: `src/data/archive/manual-images.json` 및 `public/archive/manual-images/` (아카이브 재수집·영상 재캡처 시에도 유지)
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

보고서 업로드·권한·DM 처리는 외부 계정에 접속하지 않는 테스트로 검증합니다.

```bash
npm run reports:test
npm run reports:test:browser
```

Vercel에서는 `npm run build`를 사용합니다. `/reports`는 서버에서 권한을 확인하는 경로이므로 정적 내보내기를 사용하지 않습니다. 기존 GitHub Pages 워크플로는 테스트·빌드 검증으로 변경했고, 실제 배포는 기존 Vercel 프로젝트 연결을 사용합니다. 콘텐츠 해시가 포함된 영상 경로의 1년 immutable 캐시 헤더는 유지합니다.

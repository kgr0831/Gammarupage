# GAMMARU Landing

**2026-10-12:** 웹사이트·저장소·알림 봇을 AWS에 배포했다. 새 주소는 **https://d3ktbkaahtexzk.cloudfront.net** 이다.
AWS에서는 새 회원·상태로 시작하고 기존 Vercel 원본은 보존한다. Discord callback 등록과 양쪽 업로드 로그인을 확인했다.
운영 구성은 [AWS 이전 안내](docs/aws-web-migration.md), 기존 dots 예약의 주소 변경은 [복사용 전달문](docs/dots-aws-switch.md)을 따른다.

숭실대학교 게임 제작 중앙동아리 겜마루의 랜딩페이지와 공개 게임 아카이브입니다.

현재 개발 목표는 [겜마루 운영 플랫폼 기획안](docs/gammaru-platform-plan.md)에 정리했습니다.

## 구독자 전용 데일리 브리프

AWS 사이트의 `/reports`는 동아리 HTML 보고서 보관함입니다. dots가 겜마루에 제공될 외부 자원을 조사하고 [Design.md](Design.md)를 따라 HTML을 올립니다. 별도 `/personal`에서는 개발·AI·IT 공모전과 채용 보고서를 제공합니다.

- `/reports/upload`: HTML 업로드 → 미리보기 → 등록
- `/reports`: 지금까지 올린 보고서 목록·검색
- `/reports/YYYY-MM-DD`: 날짜별 보고서와 전체 목록 링크
- `/reports/account`: Discord 로그인·구독 신청
- `/reports/admin`: 관리자 로그인 후 이름·Discord 프로필로 구독 승인

동아리 보고서는 승인된 Discord 회원만, 공모전·채용 보고서는 Discord 로그인 회원 누구나 열람합니다. 개인 공간의 상태·메모는 계정별로 분리됩니다. 알림은 각 공간의 지정 Discord 채널로 보내며, 비공개 S3에 HTML을 올리므로 매일 재배포할 필요가 없습니다.

```bash
npm run reports:dev
```

로컬 `/reports` 실행에는 `.env.funding`의 개발용 저장소·로그인 설정이 필요합니다. [AWS 연결 안내](docs/aws-web-migration.md), [dots 작업 지침](docs/dots-daily-brief.md)을 참고하세요. 기존 dots 예약의 AWS 주소 변경과 클라우드 재로그인은 별도로 필요합니다.

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

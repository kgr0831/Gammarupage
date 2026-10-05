# 기존 Vercel 사이트의 HTML 보고서 보관함

현재 사이트: **https://gammarupage.vercel.app/**. 기존 Next 앱에 `/reports`를 추가한다.
최초 기능 배포 후에는 HTML을 업로드하면 개별 URL과 누적 목록이 갱신된다.
매일 사이트를 재배포하거나 랜딩을 별도 VPS로 이전할 필요가 없다.

## 경로

| 경로 | 용도 |
| --- | --- |
| `/reports` | 최신순 누적 목록, 날짜·제목·요약 검색, 30개씩 페이지 이동 |
| `/reports/YYYY-MM-DD` | 보고서와 전체 목록으로 돌아가는 링크 |
| `/reports/YYYY-MM-DD/html` | HTML 원문 보기, 동일한 구독 권한 검사 |
| `/reports/upload` | HTML 파일 선택 → 미리보기 → 등록 |
| `/reports/login/publisher` | dots의 업로드 전용 로그인 |
| `/reports/login/admin` | 관리자 아이디·비밀번호 로그인 |
| `/reports/admin` | 이름·Discord 프로필 기반 구독 승인/취소, 알림 상태 |
| `/reports/account` | Discord 로그인, 구독 요청·해제, DM 동의 |

공개 메뉴·사이트맵에는 링크를 추가하지 않는다. 승인 검사는 목록·보고서·원본 HTML 모두에
적용한다. URL을 알아도 승인 없이 본문을 볼 수 없다.

## 기존 Vercel 프로젝트에 연결

1. `gammarupage` 프로젝트의 Storage에서 Vercel Blob 저장소를 생성하거나 연결한다.
   반드시 **Private** 저장소를 사용한다. 기존 저장소가 있다면 먼저 유형을 확인한다.
2. 서버 환경변수 `BLOB_READ_WRITE_TOKEN`을 연결한다. `NEXT_PUBLIC_` 이름을 붙이거나 소스·보고서에 넣지 않는다.
3. 아래 설정을 기존 프로젝트의 환경변수에 추가한다.

| 변수 | 값/용도 |
| --- | --- |
| `REPORTS_SITE_URL` | `https://gammarupage.vercel.app` |
| `BLOB_READ_WRITE_TOKEN` | Private Blob 토큰 |
| `FUNDING_ADMIN_USERNAME` | 관리자 아이디, 기본 `admin` |
| `FUNDING_ADMIN_TOKEN` | 기존 비공개 설정의 32자 이상 관리자 비밀번호 |
| `FUNDING_PUBLISHER_TOKEN` | 관리자와 다른 32자 이상 업로드 키 |
| `DISCORD_APPLICATION_ID` | 봇 애플리케이션 ID |
| `DISCORD_CLIENT_SECRET` | OAuth Client Secret, 봇 토큰과 다름 |
| `DISCORD_BOT_TOKEN` | 링크 DM 전송용 봇 토큰 |
| `DISCORD_DM_ENABLED` | 처음에는 `false`, 실제 수신 확인 후 `true` |

4. Discord OAuth Redirects에 `https://gammarupage.vercel.app/reports/auth/callback`을 등록한다.
5. 이 변경을 기존 Vercel 프로젝트에 한 번 배포한다. 프레임워크 Next.js, Build Command
   `npm run build`. `platform:start`나 SQLite를 사용하지 않는다. Functions의 Fluid compute와
   300초 실행 한도가 적용되는지 확인한다.
6. 관리자 로그인 → Discord 테스트 회원 신청·승인 → HTML 미리보기·등록 → 목록·개별 URL 열람을 확인한다.

이번 작업에서는 실제 Blob 생성, 환경변수 변경, 배포, DM 전송을 수행하지 않았다.
공개 사이트의 `/reports`는 아직 이 코드를 배포하기 전 상태다.

## 파일과 표시

- UTF-8 완성 HTML, 최대 2MB, `.html` 또는 `.htm`. 날짜·제목·요약은 업로드 화면에 별도로 입력한다.
- [Design.md](../Design.md)의 스타일을 문서에 포함한다. JavaScript·폼·자동 이동·추적 코드를 넣지 않는다.
- 근거 링크는 공식 HTTPS 원문이며 새 탭에서 연다.
- 과거 HTML도 등록할 수 있다. 과거 보고서에는 DM을 보내지 않는다.
- 동일 날짜의 같은 파일·제목·요약은 중복 등록하지 않는다. 다른 내용은 덮어쓰지 않고 충돌을 알린다.

원본은 Private Blob에 저장한다. 서버가 권한을 확인한 뒤 iframe sandbox와 CSP로 표시한다.
업로드된 스크립트·폼 실행은 차단하며 직접 HTML URL에도 같은 보호를 적용한다.
이는 사실 검증을 대신하지 않는다. 조사자가 공식 공고를 확인해야 한다.

## 저장과 알림

`gammaru/briefs/` 아래에 파일과 회원·세션·목록·DM 상태를 비공개로 저장한다.
메타데이터는 ETag 조건부 쓰기로 갱신하여 동시 요청이 서로의 변경을 지우지 않게 한다.
권한 조회에는 캐시를 사용하지 않아 승인 취소를 다음 요청에 반영한다. 소규모 동아리용 구조다.

확정된 당일 보고서는 승인·DM 동의한 회원에게만 알림을 예약한다. Next `after()`가 응답 이후
전송하며 함수 제한 전에 중단한다. 제한이나 Discord 429로 남은 큐는 업로드 화면의
**남은 알림 처리**로 이어서 처리한다. dot도 발행 후 대기 건수를 확인하도록 지시한다.
수신 여부가 불명확한 타임아웃·중단은 `uncertain`으로 남기고 자동 재발송하지 않는다.
봇은 `https://gammarupage.vercel.app/reports/날짜` 링크 한 줄만 보낸다.

미리보기는 만든 로그인 세션에서 30분간만 열 수 있다. 만료 객체의 저장소 자동 삭제는 아직 없다.
운영 시 `gammaru/briefs/drafts/`의 오래된 객체를 보관 정책에 맞게 정리한다.
Vercel Preview에는 별도 테스트 저장소·자격증명을 연결하고 `REPORTS_SITE_URL`도 해당 주소로 설정한다.

이번 Vercel 경로는 **완성 HTML 업로드·보관·회원 열람·링크 DM**을 담당한다.
dots의 조사·HTML 작성은 [예약 지침](dots-daily-brief.md)을 따른다. 이전 독립 시제품의
Codex CLI·팩트챗 자동 대체 조사, 문서/메일 실행 승인, SQLite 데이터는 자동 이관되지 않는다.
별도 스크럼·랜딩 CMS도 후속 범위다.

## 개발·검증

```bash
npm run reports:dev
npm run reports:test
npm run reports:test:browser
npm run build
```

로컬은 `.env.funding`을 읽는다. `REPORTS_SITE_URL`을 비우거나 `http://localhost:3000` 등
실제 로컬 주소로 설정하고 개발 전용 Private Blob을 연결한다. 자동 테스트는 메모리 저장소를
사용하며 실제 외부 서비스에 쓰지 않는다.

구현: `src/app/reports/[[...path]]/route.ts`, `funding/vercel/`.
빌드에는 디자인·동아리 정보만 포함하고 `.env*`, SQLite·Codex 로그인 데이터는 제외한다.
과거 GitHub Pages 워크플로는 Vercel 앱 검증으로 바꿨다. 실제 배포는 기존 Vercel 연결을 사용한다.

공식 참고: [Private Blob](https://vercel.com/docs/vercel-blob/private-storage),
[SDK의 캐시 없는 읽기와 조건부 쓰기](https://vercel.com/docs/vercel-blob/using-blob-sdk),
[함수 실행·파일 크기 제한](https://vercel.com/docs/functions/limitations).

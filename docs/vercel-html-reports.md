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
| `/reports/YYYY-MM-DD/html?reading=1` | 원문은 보존하고 글자·간격·한 열 배치를 적용한 읽기 화면 |
| `/reports/progress` | 모든 보고서의 공유 진행 현황·메모. 관리자와 승인된 구독자 모두 변경 |
| `/reports/research-state` | dots용 이전 보고·항목별 상태·메모 JSON. 업로드 계정 또는 관리자만 조회 |
| `/reports/instructions` | dots의 최신 수집·HTML·업로드 지침. 업로드 계정 또는 관리자만 조회 |
| `/reports/upload` | HTML 파일 선택 → 미리보기 → 등록 |
| `/reports/login/publisher` | dots의 업로드 전용 로그인 |
| `/reports/login/admin` | 관리자 아이디·비밀번호 로그인 |
| `/reports/admin` | 이름·Discord 프로필 기반 구독 승인/취소, 알림 상태 |
| `/reports/account` | Discord 로그인, 구독 요청·해제, DM 동의 |
| `/reports/session` | 메인 메뉴용 로그인·승인 상태 조회, 비공개 캐시 금지 JSON |

비로그인 메뉴·사이트맵에는 링크를 추가하지 않는다. 로그인하면 메인 페이지에 내 구독 메뉴가,
승인 후에는 일일 보고서 메뉴가 나타난다. 승인 검사는 목록·보고서·원본 HTML 모두에
적용한다. URL을 알아도 승인 없이 본문을 볼 수 없다.

첫 Discord 로그인은 프로필 이름으로 구독 신청과 보고서 DM 수신 설정을 함께 접수하며,
관리자가 승인할 때까지 `pending` 상태다. 신청자 이름과 DM 수신 설정은 내 구독에서 변경한다.
기존 회원의 구독 해제·반려·알림 거부 상태는 재로그인으로 바뀌지 않는다.
회원 로그인은 30일간 Secure·HttpOnly·SameSite=Lax 쿠키와 서버 세션으로 유지한다.
비밀번호·Discord OAuth 토큰은 localStorage에 저장하지 않는다. 로그아웃은 서버 세션도 삭제한다.

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
| `FUNDING_ADMIN_TOKEN` | 비공개 설정의 8자 이상 관리자 비밀번호 |
| `FUNDING_PUBLISHER_TOKEN` | 관리자와 다른 32자 이상 업로드 키 |
| `DISCORD_APPLICATION_ID` | 봇 애플리케이션 ID |
| `DISCORD_CLIENT_SECRET` | OAuth Client Secret, 봇 토큰과 다름 |
| `DISCORD_BOT_TOKEN` | 보고서 채널 게시·로그인/승인 확인 DM용 봇 토큰 |
| `DISCORD_REPORT_CHANNEL_ID` | 일일 보고서를 게시할 서버의 텍스트 채널 ID. 설정하면 개인 보고서 DM보다 우선 |
| `DISCORD_DM_ENABLED` | 채널 방식에서는 `false`. 채널을 지정하지 않은 이전 DM 방식에서만 사용 |

4. Discord OAuth Redirects에 `https://gammarupage.vercel.app/reports/auth/callback`을 등록한다.
5. 이 변경을 기존 Vercel 프로젝트에 한 번 배포한다. 프레임워크 Next.js, Build Command
   `npm run build`. `platform:start`나 SQLite를 사용하지 않는다. Functions의 Fluid compute와
   300초 실행 한도가 적용되는지 확인한다.
6. 관리자 로그인 → Discord 테스트 회원 신청·승인 → HTML 미리보기·등록 → 목록·개별 URL 열람을 확인한다.

운영 사이트에는 Private Blob과 Discord OAuth가 연결되어 있다. 최초 보고서 발행과 실제 DM 전송은 확인했다.
dots 반복 수집·발행 예약은 아직 별도 연결이 필요하다.

보고서 채널은 봇이 들어간 서버의 텍스트/공지 채널이어야 한다. 봇에 채널 보기·메시지 보내기 권한을 부여한다.
채널 이름으로 매번 찾지 않고 ID로 고정한다. 채널을 볼 수 있는 사람은 제목·요약을 읽을 수 있으며,
전체 HTML의 사이트 로그인·구독 승인은 계속 필요하다. 채널 접근 권한은 Discord에서 관리한다.

## 파일과 표시

- UTF-8 완성 HTML, 최대 2MB, `.html` 또는 `.htm`. 날짜·제목·요약은 업로드 화면에 별도로 입력한다.
- [Design.md](../Design.md)의 스타일을 문서에 포함한다. 실행 JavaScript·폼·자동 이동·추적 코드를 넣지 않는다.
- `script[type=application/json]#gammaru-opportunities`에 Design.md 형식의 진행 항목을 포함한다.
  비실행 데이터이며, 서버가 검증·파싱한다. 실행 코드를 허용하는 기능이 아니다.
- 근거 링크는 공식 HTTPS 원문이며 새 탭에서 연다.
- 과거 HTML도 등록할 수 있다. 과거 보고서에는 DM을 보내지 않는다.
- 동일 날짜의 같은 파일·제목·요약은 중복 등록하지 않는다. 다른 내용은 덮어쓰지 않고 충돌을 알린다.

원본은 Private Blob에 저장한다. 서버가 권한을 확인한 뒤 iframe sandbox와 CSP로 표시한다.
업로드된 스크립트·폼 실행은 차단하며 직접 HTML URL에도 같은 보호를 적용한다.
이는 사실 검증을 대신하지 않는다. 조사자가 공식 공고를 확인해야 한다.

## 상태가 다음 조사로 이어지는 흐름

1. dots가 `/reports/research-state`에서 `stateVersion`과 기존 항목의 ID·원문·상태·메모를 읽는다.
2. 신규 정보와 검토 전·보류·진행 중인 항목을 조사하고 HTML 본문과 JSON 데이터를 함께 작성한다.
3. 미리보기·발행 시 데이터를 검증하고 보고서와 항목을 하나의 조건부 쓰기로 등록한다.
4. 보고서 첫 화면의 **기회 목록**에서 관리자와 승인된 구독자 모두 상태 버튼을 한 번 눌러 저장한다.
   상태별 필터도 한 번에 선택한다. 자세한 조건·메모·전체 HTML은 펼쳐 보며 메모는 선택 입력이다.
5. 다음 조사에서 이 기록을 읽는다. 완료·안함은 중요 변화가 있을 때만 다시 보고할 수 있다.

상태: `new` 검토 전, `deferred` 보류, `in_progress` 진행 중, `completed` 진행 완료,
`dismissed` 안함. 메모는 최대 1,000자이며 마지막 30회 변경 기록을 저장한다.
보고 날짜와 별개인 항목 ID로 연결하며 새 보고서는 상태·메모를 덮어쓰지 않는다.
다른 창이 먼저 바꾼 상태는 revision 검사로, 조사 후 변경된 상태는 stateVersion 검사로 감지한다.
충돌 시 409로 중단하고 재검토를 요청한다. 회원·세션·토큰·변경자의 계정 식별자는 조사 JSON에 포함하지 않는다.

JSON이 없는 기존 HTML은 그대로 열람할 수 있다. 기존 호의 항목은 관리자만
`POST /reports/YYYY-MM-DD/opportunities`에 `manifest` 폼 필드로 한 번 연결할 수 있다.
HTML 원문·해시·발행일·알림 상태는 유지한다. 매일 새 HTML을 업로드하는 데는 재배포가 필요 없다.

## 저장과 알림

`gammaru/briefs/` 아래에 파일과 회원·세션·목록·DM 상태를 비공개로 저장한다.
메타데이터는 ETag 조건부 쓰기로 갱신하여 동시 요청이 서로의 변경을 지우지 않게 한다.
권한 조회에는 캐시를 사용하지 않아 승인 취소를 다음 요청에 반영한다. 소규모 동아리용 구조다.

채널을 설정한 경우 확정된 당일 보고서를 해당 채널에 한 번 게시하도록 예약한다. 구독자 수만큼
중복 게시하지 않으며, 개인별 보고서 DM은 만들지 않는다. Next `after()`가 응답 이후
전송하며 함수 제한 전에 중단한다. 제한이나 Discord 429로 남은 큐는 업로드 화면의
**오늘 보고서 채널 게시·대기 처리**로 이어서 처리한다. 기존에 오늘 보고서를 DM으로 발송했다면
같은 버튼으로 설정한 채널에 한 번 게시할 수 있다. 이미 채널에 전송한 보고서는 다시 보내지 않는다.
dot도 발행 후 대기 건수를 확인하도록 지시한다.
수신 여부가 불명확한 타임아웃·중단은 `uncertain`으로 남기고 자동 재발송하지 않는다.
봇은 발행일·보고서 제목·짧은 요약·`https://gammarupage.vercel.app/reports/날짜` 링크를 보낸다.
요약은 업로드 때 입력한 목록용 요약을 사용하며 알림에서는 최대 300자로 줄인다.
핵심 기회와 추천 행동을 2~3문장으로 작성한다. 요약이 비어 있으면 보고서 확인 안내를 보낸다.
이미 발송된 알림을 형식 변경만으로 자동 재발송하지 않는다.

채널 권한·설정 오류가 생겨도 개인 DM으로 우회하지 않는다. 채널 모드에서 남아 있던 개인 DM
대기 항목은 처리 시 취소한다. 채널을 지정하지 않은 이전 방식에서는 `DISCORD_DM_ENABLED=true`일 때만
승인·DM 동의한 회원에게 발송한다. 로그인·구독 승인 확인 DM은 이 일일 보고서 전송 방식과 별개다.

로그인 완료 DM은 정기 알림 스위치와 별도로, 성공한 Discord 로그인에 한해 `after()`로
안내 문구와 내 구독 링크를 전송한다. 1분 이내 재로그인·같은 작업의 중복 실행은 억제하며,
차단·실패·결과 불명은 구독 화면에 표시한다. DM 실패는 로그인을 취소하지 않는다.

구독 승인 시에도 승인 안내와 보고서·내 구독 링크를 DM으로 전송한다. 이미 승인된 회원은
내 구독의 **확인 DM 다시 받기**, 관리자는 **승인 확인 DM 보내기**로 재전송할 수 있다.
회원 본인 또는 관리자만 요청할 수 있으며, 1분 간격과 Discord 재시도 대기 시간을 지킨다.
이 안내는 정기 보고서 수신 동의와 별개이며, 승인 취소 시 대기 중인 확인 DM을 보내지 않는다.
전송 실패의 HTTP 상태와 숫자 오류 코드만 기록하고 Discord의 원문 응답은 저장하지 않는다.
봇을 회원과 같은 서버에 추가하고 서버 멤버의 DM을 허용해야 수신할 수 있다.
사이트 OAuth 로그인은 서버에 봇을 추가하는 동작을 포함하지 않는다.

미리보기는 만든 로그인 세션에서 30분간만 열 수 있다. 만료 객체의 저장소 자동 삭제는 아직 없다.
운영 시 `gammaru/briefs/drafts/`의 오래된 객체를 보관 정책에 맞게 정리한다.
Vercel Preview에는 별도 테스트 저장소·자격증명을 연결하고 `REPORTS_SITE_URL`도 해당 주소로 설정한다.

이번 Vercel 경로는 **완성 HTML 업로드·보관·회원 열람·채널 요약 알림**을 담당한다.
알림 전송만 Dishost로 분리하려면 [독립 알림 봇 안내](../discord-notifier/README.md)를 따른다.
`DISCORD_DELIVERY_MODE=worker`에서는 Vercel이 대기 기록만 저장하며 별도 봇이 가져가 전송한다.
`/reports/worker/status|claim|begin|finish`는 `DISCORD_WORKER_TOKEN`으로 인증하는 POST 전용이다.
공개 페이지·구독자·업로드 계정의 로그인으로는 이 API를 호출할 수 없다. 봇에는 Blob나 관리자 키를 주지 않는다.
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

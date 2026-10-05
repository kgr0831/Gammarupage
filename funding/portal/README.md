# GAMMARU 구독자 데일리 브리프

> 이전 상시 Node 시제품 안내다. 실제 배포는 Vercel이며, 최신 경로는 [HTML 업로드·보관함](../../docs/vercel-html-reports.md)이다. 랜딩을 VPS로 이전할 필요가 없다.

기존 겜마루 랜딩과 **같은 도메인**에서 외부 후원·운영자금·도움되는 정보를 매일 제공한다.
공개 랜딩의 메뉴·사이트맵에는 회원 경로를 추가하지 않았다. URL을 알아도 승인 없이 보고서를 볼 수 없다.

## 구현한 흐름

```text
dots 클라우드 예약 → 공식 원문 조사 → /publisher 등록·미리보기
                                             ↓
                                  Design.md 기반 날짜별 HTML 저장
                                             ↓
Discord 봇 → 승인 + DM 동의한 회원에게 링크 → Discord 로그인 → 보고서 열람

dots 보고서 미도착 → (선택) 10시 KST 팩트챗 웹 검색 → 같은 발행 경로
추천 행동 → /admin/actions 초안 검토·수정 → 별도 승인 → 문서 생성 / 설정된 이메일 발송
```

봇은 Discord REST API를 통해 링크 DM만 전송한다. 채팅 AI, 공고 검색, 명령어 응답,
불특정 채널 알림은 봇의 역할이 아니다. Gateway 접속이나 Message Content intent가 필요 없다.

| URL | 용도 | 접근 |
| --- | --- | --- |
| `/` 및 기존 경로 | 기존 Next 랜딩·아카이브 | 공개 |
| `/members` | Discord 로그인·이름 입력·구독 요청·DM 설정·해제 | 본인 |
| `/members/reports` | 날짜별 뉴스레터 목록 | 승인 회원·관리자 |
| `/members/reports/YYYY-MM-DD` | 저장된 완성 HTML 보고서 | 승인 회원·관리자 |
| `/admin/login` | 아이디·비밀번호 로그인 | 관리자 |
| `/admin` | 이름·Discord 프로필·구독 승인·취소·전송 상태 | 관리자 |
| `/admin/actions` | 추천 행동 초안·승인·결과 | 관리자 |
| `/publisher` | dots용 JSON 등록 → HTML 미리보기 → 발행 | 등록 전용 계정·관리자 |

뉴스레터를 발행하는 기계 계정은 회원 명단이나 실행 승인에 접근할 수 없다.
일반 회원이 구독을 해제하거나 관리자가 승인을 취소하면 기존 로그인 상태여도 열람이 차단된다.
승인 후 다음 발행부터 알림을 받는다. 이미 발행된 보고서는 웹 목록에서 볼 수 있다.

## 로컬 실행

Node 22.19+와 영구 SQLite를 사용한다. 새 npm 의존성은 없다.

```powershell
npm ci
# .env.funding.example 내용을 참고하여 .env.funding에 설정 (기존 파일을 덮어쓰지 않는다)
npm run platform:dev
```

기본 주소: `http://127.0.0.1:4310`.
동일 프로세스에서 기존 Next 요청은 Next로 전달하고, 회원·보고서 요청은 Node 백엔드로 처리한다.
단순 `npm run dev`는 기존 랜딩만 실행한다.

필수 설정:

- `FUNDING_ADMIN_USERNAME`: 운영자 아이디. 기본 `admin`.
- `FUNDING_ADMIN_TOKEN`: 기존에 생성한 32자 이상 비밀번호. 비밀 값은 채팅·로그에 출력하지 않는다.
- `FUNDING_PUBLISHER_TOKEN`: 관리자 비밀번호와 다른 32자 이상 무작위 등록 키.
- `FUNDING_ORIGIN`: 실제 브라우저에서 쓸 origin. 로컬 기본값 `http://127.0.0.1:4310`.
- `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_SECRET`: OAuth 설정. 봇 토큰과 Client Secret은 다르다.
- `DISCORD_BOT_TOKEN`: 구독자에게 DM을 보내는 봇.

`DISCORD_DM_ENABLED=false`가 기본이다. 첫 로그인·구독 승인·보고서 미리보기를 확인한 뒤,
테스트 수신자와 전송 범위를 정해 `true`로 활성화한다. 이 저장소 작업 중 실제 DM은 보내지 않았다.

## Discord 설정

Discord Developer Portal의 OAuth2 Redirects에 다음 주소를 정확히 등록한다.

```text
로컬: http://127.0.0.1:4310/members/auth/callback
운영: https://실제도메인/members/auth/callback
```

서버가 요청하는 사용자 scope는 `identify`뿐이다. 이메일, 비밀번호, 멤버의 Discord 토큰을
저장하지 않는다. state는 브라우저 쿠키에 연결하고 10분/1회 제한을 적용한다.
기존 봇을 동아리 Discord 서버에 초대하고, 알림 수신자의 DM 허용 설정을 확인한다.
등록 키·Client Secret·봇 토큰은 환경 파일/호스팅의 비밀 관리 기능에만 보관한다.

공식 참고: [OAuth2](https://docs.discord.com/developers/topics/oauth2),
[Create DM](https://docs.discord.com/developers/resources/user#create-dm),
[Create Message](https://docs.discord.com/developers/resources/message#create-message),
[Rate limits](https://docs.discord.com/developers/topics/rate-limits).

## PC 없이 운영하기

기존 GitHub Pages는 정적 호스팅이므로 이 로그인·SQLite·DM 서버를 실행할 수 없다.
같은 도메인을 계속 쓰려면 **기존 랜딩을 포함한 이 앱 전체를 상시 Node 서버로 배포**하거나
기존 호스팅 앞에서 회원 경로를 이 서버로 전달하는 reverse proxy를 구성해야 한다.
GitHub 소유 `github.io` 주소의 경로를 외부 서버로 바꾸는 방식은 제공하지 않는다.
사용자 소유 도메인과 상시 호스트가 필요하다. 이번 작업은 DNS나 운영 배포를 변경하지 않았다.

운영 실행:

```bash
npm ci
npm run build
npm run platform:start
```

- HTTPS 프록시는 동일 도메인의 모든 요청을 `127.0.0.1:4310`으로 전달한다.
- `FUNDING_ORIGIN=https://실제도메인`, 데이터 디렉터리는 `/var/lib/gammaru` 같은 영구 경로.
- 단일 Node 프로세스로 운영한다. Node 서버가 잠드는 무료 플랜·임시 파일시스템은 이 구성에 맞지 않는다.
- `deploy/gammaru-platform.service`와 `deploy/Caddyfile.platform.example`을 실제 경로에 맞춰 사용한다.
- Next의 `output: standalone`/정적 export용 런타임을 쓰지 않는다. 커스텀 서버와 전체 Next 앱을 함께 둔다.
- DB 백업에는 이름·Discord ID·로그인 세션이 들어간다. 공개 저장소나 공개 URL에 올리지 않는다.
- 공개 빌드 파일에는 보고서 HTML과 DB를 넣지 않는다. HTML은 접근 검사를 통과한 요청에만 반환한다.

dot의 초기 연결과 복사할 예약 작업은 [dots 일일 작업 지시문](../../docs/dots-daily-brief.md)에 있다.
일정 저장 및 계정의 dots 활성 상태를 이 코드에서 직접 관리하는 기능은 없다.

## 대체 조사와 운영 확인

주 조사자는 dot이다. 팩트챗 대체를 쓰려면 다음을 설정한다.

```dotenv
FUNDING_FALLBACK_ENABLED=true
FUNDING_FALLBACK_HOUR_KST=10
FACTCHAT_MODEL=실제계정에서-web_search와-JSON-schema를-지원하는-모델
```

키는 기존 `BAZE_API_KEY` 또는 `FACTCHAT_API_KEY`를 읽는다. 기본 비활성으로 실제 과금 호출은
이번 작업에서 하지 않았다. 모델명은 계정의 `/models` 응답과 웹 검색 지원 여부로 정한다.
대체 실행이 실패하면 자동 반복하지 않는다. 로그/설정을 확인하고 dot 발행을 재시도할 수 있다.
서버 Codex CLI를 쓰는 기존 `funding:start`는 별도 레거시 시제품이며 새 플랫폼과 동시에 운영하지 않는다.

발행한 HTML·추천 작업·DM 수신자 큐는 같은 DB 트랜잭션으로 저장한다. 날짜별 재발행은
동일 내용만 성공 처리하고 다른 내용은 충돌로 거부한다. 발행과 수신은 별개다.
관리 화면에서 `pending`, `sent`, `blocked`, `failed`, `uncertain`, `cancelled`를 확인한다.
429는 지연 후 재시도한다. 이미 보냈을 수 있는 타임아웃/5xx와 재시작 중 `sending`은
`uncertain`으로 남기고 자동 재발송하지 않는다. 오래된 미전송 큐는 다음 날 몰아서 보내지 않는다.
구독 승인·알림 동의를 발송 직전 다시 확인한다. 네트워크 전송을 시작한 뒤의 메시지는 회수하지 않는다.

`Design.md`·`style.css`·`views.mjs`를 함께 수정하면 이후 호에 적용된다. 기존 호에는 당시의
HTML/CSS와 디자인 해시가 남는다. AI 출력은 텍스트로 처리하고 검증한 HTTPS 출처만 링크로 만든다.
서버의 형식 검사만으로 사실 검증까지 끝났다는 뜻은 아니다. 공식 원문을 조사자가 확인해야 한다.

## 검증과 남은 범위

```bash
npm run platform:test
npm run platform:test:browser
npm run funding:test
npm run typecheck
npm run lint
npm run build
```

실제 AI·Discord·메일 대신 가짜 응답과 임시 DB로 로그인, 승인, 발행, 접근 회수, 중복 방지,
전송 실패 처리를 검증한다. 브라우저 캡처: `test-results/portal/`.

```bash
npm run platform:preview
```

`http://127.0.0.1:4312`는 가상 공고를 보여주는 읽기 전용 디자인 미리보기다.
실제 모집 정보로 쓰지 않는다. 운영 서버에는 이 미리보기 경로를 넣지 않았다.

남은 외부 설정은 OAuth Client Secret/Redirects, 서버·도메인 배포, dot 클라우드 로그인·일정,
동의한 실제 수신자로의 DM 확인이다. 랜딩 콘텐츠 CMS와 별도 데일리 스크럼 기능은
이 일일 정보 보고 구현에 포함하지 않았다. 지원 포털의 자동 신청·계약·결제는 구현하지 않았다.

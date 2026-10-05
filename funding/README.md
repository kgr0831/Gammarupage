# 겜마루 운영자금 탐색 에이전트

> 최신 대상은 기존 Vercel 사이트의 [HTML 업로드·보관함](../docs/vercel-html-reports.md)이다.

> 아래는 초기 독립 시제품의 기록입니다. [이전 회원 포털](portal/README.md)의 `platform:start`도 상시 서버를 전제로 한 시제품입니다. 현재 Vercel 운영에 이 서버나 채널 웹훅을 함께 실행하지 않습니다. 전체 계획은 [통합 플랫폼 기획안](../docs/gammaru-platform-plan.md)을 참고하세요.

매일 지원 기회를 조사하고, 웹에서 원문·신청 조건·다음 행동을 확인한 뒤 승인한 문서 생성과 메일 발송을 실행한다. 디스코드는 리포트 주소 하나만 전달한다. 기존 GAMMARU 사이트의 남색·분홍·연두 디자인을 사용한 별도 HTML 앱이다. 별도 디자인이 정해지면 `public/index.html`, `public/style.css`를 교체한다.

## 구현 범위

- `gammaruInfo.md`를 매 조사 시 읽는다. 현재 파일은 원본 `C:/Gammarupage/gammaruInfo.md`의 복사본이다.
- Codex CLI의 ChatGPT 로그인으로 실시간 웹 검색을 우선 시도한다. 실패·타임아웃·잘못된 JSON이면 팩트챗 Responses API의 웹 검색으로 대체한다. 정상적으로 공고를 찾지 못한 경우에는 추가 API 비용을 쓰지 않는다.
- 공식 공고 URL, 근거 요약, 신청 조건, 현금/현물/상금/후원 구분, 마감, 추천 행동과 초안을 저장한다. 모델이 낸 근거는 운영진의 최종 검토 대상이다. 서버가 원문 전체를 독립적으로 팩트체크했다는 의미는 아니다.
- 한국시간 기본 오전 9시 이후 하루 한 번 실행한다. 서버를 늦게 켜면 당일 누락분을 한 번 실행한다. 실패한 검색은 웹에서 재시도한다. 서버가 꺼진 과거 날짜들을 소급해 조사하지 않는다.
- 운영자 암호 로그인, HttpOnly/SameSite 쿠키, 동일 출처 검사, 수정본 해시 승인, 24시간 승인 유효기간, 실행/승인 기록, SQLite 영구 저장을 제공한다.
- 같은 공식 URL·마감일·작업 종류는 다음 날에도 중복 제안하지 않는다. 기존 초안은 자동 갱신하지 않는다. 운영진이 날짜와 원문을 다시 검토한다.
- 승인 후 `prepare_brief`는 검토한 본문 그대로 Markdown 문서를 만든다. `send_email`은 검토한 수신자·발신자·제목·본문 그대로 Resend로 발송 접수한다. 접수는 수신·답장·지원금 확보를 뜻하지 않는다.
- 실제 지원 포털 입력/제출, 인증서·본인확인, 계약, 결제, 첨부 서류 제출은 아직 수동이다. 기관별로 실행기를 추가해야 한다. 현재 AI가 임의의 명령이나 브라우저 조작으로 실행할 수 있는 경로는 없다.

## 구조와 호스팅 선택

```text
원격 Linux 서버 (하나의 Node 프로세스 + 영구 디스크)
  매일 KST 스케줄 → gammaruInfo.md → Codex CLI
                                   실패 시 → 팩트챗 웹 검색 API
                    ↓
             SQLite 리포트·제안 저장 → Discord Webhook: 리포트 링크
                    ↓
  HTTPS HTML 보드 → 운영자 검토/수정 → 승인 → 문서 / 이메일
```

기존 Next.js 사이트는 GitHub Pages로 정적 배포한다. 설치된 Next 16.3.4의 `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`에 따르면 쿠키·동적 요청 처리·Server Actions는 정적 export에 포함할 수 없다. 따라서 운영진 데이터와 실행 서버를 `funding.example.org` 같은 별도 도메인에서 운영한다. 기존 Next 배포 설정을 변경하지 않는다.

현재 선택은 **소형 Linux VM/VPS + 단일 Node 서비스 + HTTPS 프록시**다. 개인 PC를 끌 수 있고 Codex 로그인과 데이터가 서버에 남는다. CPU/GPU 추론을 직접 하지 않으므로 GPU 서버는 필요 없다. 서버 제공 업체·월 예산·도메인은 아직 미정이며 인프라 생성이나 배포는 수행하지 않았다. 이 프로세스는 영구 디스크가 없는 서버리스 함수나 수면 상태로 내려가는 무료 웹호스팅에 그대로 배포하지 않는다. 같은 데이터 디렉터리로 여러 프로세스를 띄우지 않는다.

## 로컬 미리보기와 검증

Node **22.19.0 이상**을 기준으로 검증했다. Node 내장 `node:sqlite`를 쓰며 22에서는 experimental 경고가 출력될 수 있다. 새 npm 의존성은 없다.

```bash
npm run funding:preview
npm run funding:test
npm run funding:test:browser
```

미리보기는 `http://127.0.0.1:4311`, 가상 공고, 임시 DB, 읽기 전용이다. 실제 AI·디스코드·메일 호출을 하지 않는다. 포트는 `FUNDING_PREVIEW_PORT`로 바꿀 수 있다. 브라우저 검증은 저장소의 Playwright와 Microsoft Edge를 쓴다. 다른 설치 브라우저가 필요하면 `PLAYWRIGHT_CHANNEL`을 지정한다. 캡처는 `test-results/funding/`에 저장된다.

실제 실행은 `.env.funding.example`을 `.env.funding`으로 복사하고 값을 로컬에서 입력한 후 시작한다. 관리자 암호와 키는 채팅/소스/스크린샷에 넣지 않는다.

```bash
npm run funding:start
```

`http://127.0.0.1:4310`에서 운영자 암호로 로그인한다. 실사용 데이터는 기본 `funding/data/funding.sqlite`에 저장되며 Git에서 제외한다. Windows에서 `FUNDING_CODEX_BIN`은 npm의 `.cmd`/`.ps1` 래퍼가 아니라 설치 패키지의 네이티브 `codex.exe` 절대 경로를 지정한다. 원격 운영은 Linux를 권장한다.

## 원격 서버 설치 순서

아래는 **서버와 도메인을 정한 뒤 운영자가 실행할 절차**다. 서버 생성·DNS 수정·서비스 공개는 아직 승인하거나 실행한 상태가 아니다.

1. Linux 서버에 Node 22.19 이상과 Caddy를 설치한다. 서버 시각 동기화를 켜고 영구 디스크를 사용한다. 코드 경로는 `/opt/gammaru`로 가정한다. 런타임 자체는 npm 의존성 없이 실행된다.
2. 전용 OS 사용자 `gammaru`와 `/var/lib/gammaru`, `/home/gammaru/.codex-funding`을 만든다. 두 디렉터리는 해당 사용자만 읽고 쓰도록 한다. 코드와 `gammaruInfo.md`는 읽을 수 있어야 한다.
3. 서버에 Codex CLI를 설치한다. 이번 구현은 로컬 CLI **0.160.0**의 옵션과 공식 CLI 문서를 확인했다. 같은 버전을 쓰려면 `npm install --global @openai/codex@0.160.0`으로 설치한다. CLI 실제 실행 파일 경로를 확인한다.
4. `gammaru` 사용자로 서버에서 직접 로그인한다. 개인 PC의 인증 파일을 복사하지 않는다.

   ```bash
   export CODEX_HOME=/home/gammaru/.codex-funding
   codex login --device-auth
   codex login status
   ```

   브라우저에서 본인이 로그인한다. 계정 보안 설정 또는 워크스페이스에서 device-code 로그인을 허용해야 할 수 있다. 서버에 생긴 인증 파일은 출력하거나 저장소에 넣지 않는다. 공식 문서는 [headless 로그인](https://learn.chatgpt.com/docs/auth)을 설명한다.

5. `/etc/gammaru-funding.env`에 아래 설정과 필요 키를 입력한다. 파일은 root가 관리하고 일반 사용자에게 읽기 권한을 주지 않는다. systemd가 읽어서 프로세스에 전달한다. 경로에는 절대 경로를 사용한다.

   ```dotenv
   FUNDING_ADMIN_TOKEN=<암호 관리자에서 생성한 32자 이상의 무작위 암호>
   FUNDING_ORIGIN=https://funding.example.org
   FUNDING_HOST=127.0.0.1
   FUNDING_PORT=4310
   FUNDING_DATA_DIR=/var/lib/gammaru
   GAMMARU_INFO_PATH=/opt/gammaru/gammaruInfo.md
   FUNDING_CODEX_HOME=/home/gammaru/.codex-funding
   FUNDING_CODEX_BIN=/usr/local/bin/codex
   FUNDING_SCHEDULE_ENABLED=false
   FUNDING_HOUR_KST=9
   ```

   `FUNDING_CODEX_BIN`과 서비스 파일의 `/usr/bin/node`는 실제 설치 위치에 맞춘다. `FUNDING_CODEX_MODEL`은 계정에 허용된 모델을 지정할 때만 넣는다. 비워두면 CLI 기본 모델을 쓴다. 사용자 Codex 설정·MCP·플러그인 설정은 불러오지 않는다.

6. [gammaru-funding.service](deploy/gammaru-funding.service)를 `/etc/systemd/system/`에 설치한다. [Caddyfile.example](deploy/Caddyfile.example)의 도메인을 바꾸고 DNS를 서버로 연결한다. Caddy는 443/80, 앱은 loopback의 4310만 수신하게 한다. [Caddy 공식 설정](https://caddyserver.com/docs/quick-starts/reverse-proxy)을 따른다. 기존 Caddy 설정은 덮어쓰지 말고 사이트 블록을 추가한다.
7. 설정 검토 후 `systemctl daemon-reload`, `systemctl enable --now gammaru-funding`으로 시작한다. HTTPS 보드에 로그인해 수동 검색 1회와 알림을 확인한다. 실제 검색은 Codex 사용량을 소비하며 실패 시 설정한 팩트챗 비용이 발생할 수 있다.
8. 실제 결과가 확인되면 `FUNDING_SCHEDULE_ENABLED=true`로 바꾸고 서비스를 재시작한다. 이후 PC가 꺼져 있어도 **원격 서버가 가동 중이면** 매일 검색한다.

서버 중단 시 실행 중이던 검색은 실패, 메일 작업은 결과 불명으로 복구된다. 메일 서비스에서 실제 발송 결과를 확인한 뒤 웹에서 완료/취소를 기록한다. 자동 재발송하지 않는다. 프로세스 재시작은 웹 세션을 만료시킨다. 백업은 서비스를 중지한 동안 `/var/lib/gammaru` 전체를 보호된 백업 저장소에 보관하는 방법이 가장 단순하다. 실행 중인 SQLite 파일 하나만 복사하지 않는다.

## 팩트챗·디스코드·메일 연결

팩트챗은 마인드로직의 API Gateway로 해석했다. 현재 구현 경로는 `https://factchat-cloud.mindlogic.ai/v1/gateway/responses/`다. [공식 Responses 문서](https://docs.mindlogic.ai/docs/general/api-gateway/reference/responses-api)와 [서버 웹 검색 문서](https://docs.mindlogic.ai/docs/general/api-gateway/reference/server-tools)를 확인했다.

`FACTCHAT_API_KEY`와 `FACTCHAT_MODEL`을 서버에 입력한다. 조직에서 사용할 수 있는 **OpenAI 모델이며 웹 검색과 JSON schema 출력을 지원하는 모델**을 선택해야 한다. 임의 모델명을 기본값으로 넣지 않았다. 공식 `/v1/gateway/models/` 및 모델 상세에서 권한과 검색 지원을 확인한다. 웹 검색 기록이나 완료 응답이 없으면 유효한 리포트로 취급하지 않는다. 일반 채팅을 실시간 검색으로 가장하지 않는다. 이 경로는 ChatGPT 구독의 API 크레딧이 아니라 별도의 팩트챗 과금이다. 계정별 지원 모델·실제 과금은 아직 확인하지 않았다.

디스코드 채널에서 Incoming Webhook을 만들고 `DISCORD_WEBHOOK_URL`에 저장한다. 링크만 보내므로 상시 Gateway 연결이나 discord.js가 필요 없다. 리포트를 먼저 저장한 후 알림을 보내며 멘션과 링크 미리보기를 끈다. 실패하거나 결과가 불명확하면 운영 기록에 표시한다. 중복 알림을 피하려고 자동 재전송하지 않는다. [Discord Execute Webhook 문서](https://docs.discord.com/developers/resources/webhook#execute-webhook)를 따른다.

메일 자동 발송을 쓸 때만 Resend에서 발신 도메인을 인증하고 `RESEND_API_KEY`, `FUNDING_EMAIL_FROM`을 넣는다. 예: `GAMMARU <운영진의 실제 주소>`. 유료 계정 생성이나 발신 도메인 인증은 수행하지 않았다. [공식 발송 API](https://resend.com/docs/api-reference/emails/send-email)를 사용하고 작업별 idempotency key를 보낸다. 발신 계정을 나중에 연결/변경했다면 기존 초안을 한 번 저장해 새 발신자를 표시한 뒤 다시 승인한다.

승인 버튼은 실제 외부 발송이다. 원문·수신자·본문 확인 체크가 필요하고, 수정한 초안은 저장한 뒤 다시 확인해야 한다. 인증서가 필요한 포털 지원이나 계약·입금·결제는 이 승인에 포함되지 않는다.

## dots와 Codex 원격 실행

2026-10-02 공식 문서 기준으로 dots는 실제로 존재하며 자체 클라우드 컴퓨터/브라우저에서 PC가 꺼져 있어도 작동한다. 다만 순차 제공 중이며 사용자의 계정에 활성화돼 있는지는 확인하지 못했다. [Meet dots](https://learn.chatgpt.com/docs/dots)

| 경로 | PC가 꺼져 있어도 작업 | 이 프로젝트에서의 역할 |
| --- | --- | --- |
| 이 서버 + Codex CLI 로그인 | 서버가 켜져 있으면 가능 | 구현된 일일 조사·웹 보드·승인 실행 경로 |
| dots 자체 클라우드 작업 | 가능, 계정 접근 필요 | 추가 조사·리포트 검토·다음 행동 논의 |
| dots → Codex Cloud 환경 | 가능, 환경 사전 설정 필요 | 저장소 개발·수정 작업 |
| Codex Remote로 개인 PC 연결 | 해당 PC가 켜져 있어야 함 | PC를 끌 수 있어야 한다는 조건만으로는 적합하지 않음 |
| 로컬 파일을 사용하는 데스크톱 예약 작업 | PC·앱 실행 필요 | 개인 PC의 일일 운영 방식으로 사용하지 않음 |

공식 [dots 작업 안내](https://learn.chatgpt.com/docs/dots/tasks-and-memory)는 이미 만든 Codex Cloud 환경으로 코딩 작업을 시작할 수 있다고 설명한다. 환경은 [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments)에서 저장소와 실행 설정을 준비한다. 원격 PC 연결은 [Remote](https://learn.chatgpt.com/docs/remote), 로컬 예약 작업 조건은 [Scheduled tasks](https://learn.chatgpt.com/docs/automations)를 참고한다.

이 구현은 **dots의 미공개 REST API나 개인 인증 토큰 추출에 의존하지 않는다.** dots가 계정에서 제공되면 보조 운영 에이전트로 연결한다. dots에 리포트 검토를 맡기는 경우 클라우드에서 접근 가능한 프로필/리포트를 제공하고, 해당 연결의 접근 권한을 별도로 설정한다. 로컬 `gammaruInfo.md` 경로를 알려주는 것만으로 클라우드가 읽을 수 있는 것은 아니다. 현재 운영 보드 로그인과 dots 연결은 자동 설정하지 않았다.

dots에서 사용할 검토 요청 예시:

> 겜마루 운영자금 리포트를 검토해 줘. 매일 오전 9시 30분 Asia/Seoul에, 내가 접근을 허용한 리포트와 동아리 프로필을 읽고 오늘 우선 처리할 기회를 세 개 이내로 정리해 줘. 신청 자격이 불확실한 사항은 원문으로 확인하고 질문으로 남겨 줘. 기관에 연락하거나 지원서를 제출하지 말고 최종 수신자·본문·첨부 목록을 먼저 보여 줘. 실제 발송은 운영 보드에서 내가 승인한 작업으로만 진행해. 반복 일정이 저장되면 시간대와 전달 위치를 확인해 줘.

위 문장은 아직 예약된 작업이 아니다. dots가 전달 위치/도구/권한을 사용할 수 있는지 확인한 후 일정 저장 결과를 확인한다. Codex Cloud 개발 환경은 이 앱의 영구 웹 서버·SQLite 저장소가 아니라 작업별 실행 환경으로 취급한다.

## 남은 실제 설정과 검증

현재 로컬에서 자동 테스트와 브라우저 동작을 검증했다. 실제 Codex 계정 조사, 팩트챗 과금 호출, Discord 채널 전송, Resend 발송, 원격 배포는 하지 않았다. `운영 기록`의 “설정됨”은 환경변수 존재 확인이며 접속 성공을 뜻하지 않는다.

실운영을 끝내려면 서버/도메인 결정, 서버의 Codex 로그인, 팩트챗 API 권한·모델 선택, Discord 웹훅 연결이 필요하다. 이메일 실행을 원하면 발신 주소·서비스 설정도 필요하다. 겜마루 프로필에는 실제 참여 인원·목표 금액·용도·대표자·사업자 여부가 없으므로 해당 정보가 필요한 지원 자격은 확인 필요로 남긴다.

주요 관리 파일:

| 파일 | 역할 |
| --- | --- |
| `config.mjs`, `.env.funding.example` | 환경과 예약 시각 |
| `providers.mjs`, `schema.mjs` | 검색 지침, 제공자 우선순위, 데이터 검증 |
| `store.mjs`, `service.mjs`, `server.mjs` | 영구 기록, 승인, 실행, 인증/API |
| `public/` | 웹 리포트·승인 화면 |
| `deploy/` | Linux 서비스·HTTPS 설정 예시 |
| `tests/` | 오프라인 자동 검증·브라우저 검증·가상 데이터 |

# 겜마루 디스코드 알림 봇 — Dishost 배포

보고서 사이트는 `https://gammarupage.vercel.app`에 유지한다. 이 폴더만 Dishost에 배포한다.
봇이 60초마다 사이트의 대기 알림을 가져와 `데일리-스크럼`에 요약과 링크를 보낸다.
기존 로그인 완료·구독 승인 DM도 이 봇이 처리한다. dots는 기존 사이트에 HTML을 업로드하면 된다.

## 1. Dishost 봇 만들기

1. [Dishost 대시보드](https://dishost.kr/dashboard)에서 **봇 생성**을 누른다.
2. 이름은 `겜마루 알림 봇`, 플랫폼은 **NodeJS**로 선택한다.
3. 기존 겜마루 봇 토큰을 입력한다. Discord 애플리케이션을 새로 만들 필요는 없다.
4. 실행 환경은 **Node.js 22 이상**, 시작 파일은 **index.js**로 설정한다.

## 2. 파일 올리기

제공한 `gammaru-discord-notifier.zip`을 파일 매니저에 업로드하고 **압축 풀기**를 선택한다.
다음 파일들이 실행 폴더 바로 아래에 있어야 한다.

```text
index.js
worker.mjs
package.json
package-lock.json
.env.example
README.md
```

ZIP에는 비밀값과 실제 `.env`가 없다. 이 봇은 Node 내장 기능만 사용해 추가 패키지가 필요 없다.
프로젝트 전체, Next.js, 이미지, 보고서 파일, `node_modules`를 올리지 않는다.

## 3. 환경변수 입력

호스팅 환경변수 기능을 사용하거나, 파일 매니저에서 `.env.example`을 참고해 `.env`를 만든다.
키는 대화·GitHub·로그에 남기지 않고 해당 비공개 설정에 직접 입력한다.

| 이름 | 값 |
| --- | --- |
| `REPORTS_SITE_URL` | `https://gammarupage.vercel.app` |
| `DISCORD_BOT_TOKEN` | 기존 겜마루 봇 토큰. 호스팅이 `DISCORD_TOKEN`으로 제공하면 그것도 인식한다 |
| `DISCORD_WORKER_TOKEN` | Vercel과 동일한 전용 연결 키. 관리자·업로드 키와 다른 32자 이상 값 |
| `DISCORD_POLL_SECONDS` | `60` |

봇에는 관리자 비밀번호, 업로드 키, Discord OAuth 비밀값, Blob 토큰이 필요 없다.
전송 채널은 사이트의 기존 `DISCORD_REPORT_CHANNEL_ID` 설정을 따른다.

## 4. 연결 확인 후 전환

Vercel 프로젝트에는 `DISCORD_WORKER_TOKEN`을 등록하고 재배포한다.
이때 `DISCORD_DELIVERY_MODE=direct`이면 기존 전송이 계속된다.

셸을 사용할 수 있다면 `node index.js --check`로 사이트 인증과 봇 인증만 확인한다.
이 명령은 대기 작업을 가져오거나 Discord 메시지를 보내지 않는다.
일반 시작도 같은 인증 확인을 먼저 실행한다.

파일과 키를 넣은 Dishost 봇이 준비되면 Vercel의 `DISCORD_DELIVERY_MODE`를 **worker**로 바꾸고
재배포한다. Dishost에서 시작 버튼을 누르거나 이미 실행 중이면 다음 확인까지 기다린다.
설정 오류 뒤에는 최대 5분 간격으로 재확인한다.

전환 후 Vercel은 알림을 저장하고 Dishost가 실제 발송한다. `DISCORD_BOT_TOKEN`은 전환 검증 후
Vercel에서 제거할 수 있다. Discord 웹 로그인에 쓰는 `DISCORD_APPLICATION_ID`와
`DISCORD_CLIENT_SECRET`은 Vercel에 그대로 둔다.

## 5. 확인할 것

- 콘솔의 `겜마루 알림 봇 시작`은 실행 시작, `알림 처리: sent`는 사이트에 전송 완료를 기록했다는 뜻이다.
- 실제 오늘 보고서가 등록된 뒤 Discord 채널의 요약·링크와 사이트 전송 기록을 함께 확인한다.
- `uncertain`은 Discord 수신 여부가 불명확한 상태다. 중복 전송을 막기 위해 자동 재발송하지 않는다.
- 이 봇은 알림 전송용 REST API를 사용한다. Discord의 온라인 표시와 메시지 수신 인텐트는 사용하지 않는다.
- 봇 서버가 꺼져도 보고서와 상태 기록은 유지된다. 지난 날짜의 일일 알림은 뒤늦게 발송하지 않는다.

문제가 생기면 Vercel을 `direct` 모드로 되돌리고 재배포해 기존 전송을 사용할 수 있다.
이 경우 Vercel에 봇 토큰이 필요하다. 이미 전송된 알림이나 결과가 불명확한 알림을 임의로 재발송하지 않는다.

공식 안내: [봇 생성](https://dishost.kr/docs/bot-creation), [Node.js·ZIP 업로드](https://dishost.kr/docs/quickstarts/nodejs).

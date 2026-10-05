# 개인 데일리 브리핑 — 별도 서비스

겜마루 서비스를 유지하면서 개인용 서비스를 별도 Vercel 프로젝트와 주소에 배포한다.
두 배포는 보고서 엔진을 재사용하지만 데이터·세션·업로드 키·보고 지침·알림 대상을 공유하지 않는다.

| 구분 | 겜마루 | 개인 브리핑 |
| --- | --- | --- |
| 사이트 | https://gammarupage.vercel.app | 별도 Vercel 프로젝트 주소 |
| REPORTS_SERVICE | club (기본값) | personal |
| 수집 | 동아리 후원·운영자금·유용한 정보 | 개발·AI·IT 공모전/채용, 미국 주식·ETF |
| 열람·진행 상태 변경 | 관리자와 승인된 구독자 | 관리자와 승인된 소유자 |
| 일일 알림 | 기존 Dishost 봇 → 데일리 스크럼 채널 | 개인 사이트 → 본인 Discord DM |
| 자료 | Design.md, dots-daily-brief.md, gammaruInfo.md | personal-Design.md, dots-personal-brief.md, personal-brief-profile.md |
| 저장 경로 | gammaru/briefs/ | personal/briefs/ |

## 개인 배포 설정

- `REPORTS_SERVICE=personal`, `REPORTS_SITE_URL=개인 사이트 HTTPS 주소`.
- `REPORTS_PERSONAL_OWNER_ID=소유자의 Discord ID`. 누락하면 서비스는 열리지 않는다.
- 별도 Private Blob의 `BLOB_READ_WRITE_TOKEN`을 연결한다.
- 관리자 및 업로드 키를 별도로 발급한다. 실제 값은 비공개 환경변수에만 보관한다.
- Discord OAuth의 허용 Redirect에 `개인 사이트 주소/reports/auth/callback`을 **추가**한다.
  기존 겜마루 Redirect는 유지한다.
- `DISCORD_DELIVERY_MODE=direct`, `DISCORD_DM_ENABLED=true`, `DISCORD_REPORT_CHANNEL_ID`는 비워 둔다.
  개인용에서 채널 설정이 남아 있어도 본인 DM만 허용한다. 기존 Dishost 설정은 변경하지 않는다.
- 새 사이트에서 소유자가 Discord로 로그인하면 구독 요청이 생성된다. 해당 사이트 관리자 화면에서 승인한다.

루트 주소는 개인 보고서 목록 `/reports`로 이동한다. 로그인·HTML 업로드·날짜별 보고서 경로는
겜마루와 같지만 호스트가 다르다. 같은 날짜의 보고서를 각각 발행할 수 있고, 상태·메모·세션도 독립적이다.
개인 보고서를 동아리 업로드에 넣으면 검증 단계에서 거절한다. 기존 동아리 HTML에는 개인 audience/category를 요구하지 않는다.

## dots 연결

개인 사이트의 `/reports/login/publisher`에 별도 업로드 키로 로그인한다.
`/reports/upload?guide=1`에는 해당 사이트 주소를 반영한 개인 지침·프로필·디자인·진행 상태가 나온다.
동아리 작업은 계속 유지하고 개인 브리핑을 별도 작업으로 등록한다. 개인 예약끼리만 중복을 확인한다.
실제 첫 개인 발행·DM·예약 저장은 각각 확인한다. 배포만으로 dots 예약이 생기지는 않는다.

개인 자격·경력·지역·투자 성향은 미확정이다. [개인 프로필](personal-brief-profile.md)의 조건을 사용한다.
지원서 제출·자동 매매·팩트챗 자동 대체는 이번 범위에 포함하지 않는다.

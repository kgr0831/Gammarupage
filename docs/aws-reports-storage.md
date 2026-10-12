# 보고서 저장소를 AWS S3로 이전

웹사이트와 URL은 Vercel에 유지한다. Discord 알림 경로와 dots 예약도 유지한다.
저장소만 서울 리전 S3로 바꾸며 새 EC2·RDS·NAT Gateway는 만들지 않는다.

## 현재 확인한 접근 상태

- AWS 계정 `066523631431`, CLI 사용자 `dudri-deployer`, 기본 리전 `ap-northeast-2`.
- 사용자가 `GammaruReportsMigration` 정책을 추가한 뒤, 전용 서울 S3 버킷과 Vercel OIDC 제공자·역할 구성을 완료했다.
- 실제 버킷의 리전·퍼블릭 차단·AES256 암호화·버전 관리 비활성·Lifecycle 4개 규칙·역할 신뢰 조건과 범위를 확인했다.
- 두 namespace에서 CLI 사용자의 실제 읽기·쓰기·조건부 갱신을 검증했다. 오래된 ETag 및 기존 파일 덮어쓰기가 거절됐고, 검증용 임시 파일은 제거했다. 운영 데이터는 아직 복사하지 않았다.
- Vercel production 역할의 실제 실행 검증은 데이터 이전 단계에서 진행한다. CLI 사용자 검증과 구분한다.
- 크레딧 API는 `IAM user access not activated`로 거절됐다. 루트 사용자의 결제 정보 IAM 접근 활성화가 별도로 필요하다.
- 크레딧 $100는 사용자의 예상 잔액이며 실제 잔액·기한·S3 적용 여부는 아직 미확인이다.
- 원본 Blob은 사용량 초과로 정지되어 있다. 기존 데이터가 읽히기 전에는 빈 S3로 전환하지 않는다.
- 준비 코드는 커밋 `ccf8b3aa89006479bfffbf68bcf65c61ca33b5d3`로 배포했다. Production backend는 여전히 `blob`이며 운영 이전은 미완료다.

## 1. 이번 작업용 권한 추가

계정 관리 권한이 있는 사용자로 AWS 콘솔에 로그인한다.
IAM → 사용자 → `dudri-deployer` → 권한 추가 → 인라인 정책 생성 → JSON에서
[권한 정책](../infra/aws-bootstrap-permissions.json)의 전체 내용을 붙여넣고
`GammaruReportsMigration`으로 저장한다. 정책이 붙은 뒤 CLI에서 다시 검증한다.
정책은 지정 버킷·Vercel 인증 제공자·보고서 역할과 크레딧 조회에 한정한다.

크레딧 조회가 `IAM user access not activated`로 거절되면, 루트 사용자로
[AWS 계정 설정](https://console.aws.amazon.com/billing/home?#/account)에 들어가
`IAM 사용자 및 역할의 결제 정보 액세스` → `편집` → `IAM 액세스 활성화` → `업데이트`를 선택한다.
정책의 `billing:GetCredits`와 계정의 결제 접근 활성화는 별도 조건이다.
활성화 전에는 크레딧 잔액이 확인됐다고 보고하지 않는다.

## 2. AWS 구성

계정과 대상을 확인하는 기본 명령은 읽기 전용이다.

```powershell
uv run --no-project --with botocore python scripts/bootstrap-reports-aws.py
```

승인된 AWS 이전을 실제 적용할 때만 `--apply`를 붙인다.
스크립트는 계정 번호를 검사하며, 지정 버킷과 인증 제공자·역할만 생성 또는 설정한다.
장기 액세스 키를 만들거나 복사하지 않는다. 기존 `dudri-deployer` 키를 Vercel에 넣지 않는다.

- 버킷: `gammaru-daily-scrum-066523631431-seoul`, S3 Standard, 비공개, 퍼블릭 접근 차단, SSE-S3 암호화.
- 역할: `gammaru-reports-vercel`. OIDC의 팀·프로젝트·production 클레임을 정확히 제한한다.
- Vercel 프로젝트의 OIDC는 현재 team issuer 모드임을 확인했다.
- 함수 권한: 해당 버킷의 두 보고서 namespace에만 List/Get/Put/Delete.
- 일반 버킷의 조건부 쓰기 `If-Match`/`If-None-Match`로 기존 동시 변경 보호를 유지한다.
- 버킷 버전 관리는 사용하지 않는다. HTML 수정본은 기존 해시별 파일 구조로 보존한다.

## 3. 배포 설정 및 데이터 이전

다음은 비밀값이 아닌 설정이다. Production 환경에 설정하되 데이터 검증 전에는
`REPORTS_STORAGE_BACKEND=blob`을 유지한다.

```dotenv
REPORTS_STORAGE_BACKEND=blob
REPORTS_S3_BUCKET=gammaru-daily-scrum-066523631431-seoul
REPORTS_S3_REGION=ap-northeast-2
REPORTS_S3_ACCOUNT_ID=066523631431
REPORTS_AWS_ROLE_ARN=arn:aws:iam::066523631431:role/gammaru-reports-vercel
```

`CRON_SECRET`은 새 무작위 32바이트 이상을 생성해 Vercel의 Sensitive 환경변수로만 저장한다.
값을 문서·터미널·Git·URL에 남기지 않는다.

1. 원본 Blob의 읽기 제한을 정상적으로 해제하거나 검증 가능한 최신 백업을 확보한다.
2. 데이터 이전과 전환 중에는 dots 발행, 사용자 상태 변경, 알림 처리의 쓰기를 멈춘다.
3. `POST /api/maintenance/report-migration`에 `Authorization: Bearer <CRON_SECRET>`을 보내 실행한다.
   전송은 서버 메모리에서 수행하며 원본은 삭제하지 않는다. 두 namespace의 파일을 검증한 뒤 index를 마지막에 기록한다.
   원본 상태가 바뀌거나 대상 파일이 이미 다른 내용을 가지면 덮어쓰지 않고 실패한다.
4. 응답의 `verified: true`, 두 namespace의 보고서 개수·stateVersion을 확인한다.
   이 확인은 실행 당시 값이므로 전환 전까지 쓰기 중단을 유지해야 한다.
5. `REPORTS_STORAGE_BACKEND=s3`로 바꿔 재배포한다. 전환 후 이전 엔드포인트는 409로 차단된다.
6. 양쪽 로그인, 조사 자료, 최근 보고서 HTML, 계정별 상태·메모와 실제 알림 경로를 검증한다.
   재발행·테스트 알림을 임의로 생성하지 않는다. 실패 시 원본을 보존한 채 전환을 중단한다.
7. 검증 후 쓰기를 재개하고 미발행 작업은 dots가 최신 상태를 다시 읽어 진행한다.

### 현재 남은 원본 접근 문제

Vercel의 `gammaru-reports`는 `limits-exceeded-suspended` / `usageQuotaExceeded=true` 상태다.
공식 안내상 Hobby 한도 갱신을 기다리거나 Pro 체험으로 제한을 해제할 수 있다.
해당 팀의 체험 가능 여부는 미확인이다. 유료 요금제 변경은 별도 동의 없이 진행하지 않는다.
읽기가 복구되면 최신 원본을 검증해 이전하며, 확인되지 않은 로컬 예전 기록으로 최신 상태를 대체하지 않는다.

## 최근 7일 보관

- 한국시간 오늘을 포함한 최근 7개 날짜만 목록과 보고서 URL에서 열람한다.
  예: 10월 12일에는 10월 6일~12일을 남기고 10월 5일 이전을 제거한다.
- 원본 HTML과 모든 수정본, 해당 보고서의 오래된 알림 기록을 제거한다.
  항목 ID·원문·진행 상태·메모·개인별 기록·회원·로그인 세션·프로필은 삭제하지 않는다.
- 자동 정리: Vercel Cron `10 15 * * *` (한국시간 00:10 예정).
  Hobby의 시각 정밀도는 1시간 범위이므로 실제 실행은 지연될 수 있다.
  웹사이트는 정리 실행 전이라도 한국시간 날짜 기준으로 오래된 HTML 접근을 차단한다.
- index에서 제거하고 삭제 대기열을 먼저 저장한 뒤 실제 파일을 삭제한다.
  중간에 실패한 삭제는 다음 실행에서 재개한다. 삭제 대기 건이 남으면 HTTP 503을 반환한다.
- S3 Lifecycle은 HTML 객체 생성 후 7일, 업로드 초안은 1일 경과 후 정리를 보조한다.
  Lifecycle은 UTC 기준 비동기 처리이므로 정확한 날짜별 보관은 애플리케이션의 index 정리가 담당한다.
  `index-v1.json`에는 만료 규칙이 없다.
- 보관 기간을 지난 날짜는 신규 등록·재발행할 수 없다.
  dots는 HTML 목록 대신 유지된 `known`과 `stateVersion`으로 중복을 판단한다.

## 공식 근거

- [Vercel에서 AWS OIDC 연결](https://vercel.com/docs/oidc/aws)
- [S3 조건부 쓰기](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [S3 만료 처리](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)
- [Vercel Cron 제한](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [AWS 크레딧 조회](https://docs.aws.amazon.com/cli/latest/reference/billing/get-credits.html)
- [AWS 결제 정보 IAM 접근 활성화](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/billing-getting-started.html)
- [Vercel Blob 한도와 체험 안내](https://vercel.com/docs/vercel-blob/usage-and-pricing)

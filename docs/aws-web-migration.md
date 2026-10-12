# 웹사이트와 알림 봇의 AWS 이전

2026-10-12 사용자가 웹사이트·보고서 저장소·알림 봇 전체의 AWS 이전과 **새 데이터로 시작**을 선택했다.
Vercel 유료 전환은 하지 않는다. 기존 Vercel Blob의 회원·상태·메모·HTML은 변경하거나 삭제하지 않는다.
기존 원본이 나중에 열려도 AWS index에 자동 덮어쓰기·병합하지 않는다.

## 현재 상태

- 서울의 비공개 S3 버킷은 생성·검증 완료. 앱의 두 namespace에서 조건부 쓰기까지 확인했다.
- AWS 웹 배포 파일과 추가 권한 정책은 준비됨. **새 EC2·CloudFront·AWS 웹사이트는 아직 배포되지 않았다.**
- `dudri-deployer`로 CloudFormation·CloudFront·Amazon Linux 이미지 파라미터를 조회하면 접근 거절된다.
- 기존 `dudri-api` 인스턴스는 다른 프로젝트이며 변경하지 않는다.
- AWS 크레딧 잔액·기한은 아직 조회 권한이 없어 미확인이다. $100가 있다고 단정하지 않는다.
- dots 예약은 이 배포 스크립트가 변경하지 않는다. 새 URL 확정 후 기존 예약의 주소를 바꿔야 한다.

## 구성

| 역할 | AWS 구성 |
| --- | --- |
| 웹사이트·로그인·상태 저장 API | 서울 EC2 `gammaru-web`, ARM `t4g.small`, 암호화 gp3 20 GiB |
| HTTPS 주소 | CloudFront 기본 도메인, VPC origin으로 EC2에 연결 |
| 보고서 HTML·계정·진행 상태 | 기존 생성한 전용 비공개 S3 |
| 겜마루 Discord 알림 | EC2의 `gammaru-notifier.service`, 기존 worker 코드 |
| 개인 보고서 Discord 알림 | EC2의 웹 프로세스가 기존 채널 전송 코드 실행 |
| 오래된 HTML 정리 | EC2 systemd timer, 한국시간 00:10, 부팅 시 놓친 실행 보완 |
| 비밀 설정 | SSM SecureString `/gammaru/web/runtime`, 서버에서만 읽는 0600 파일 |
| 서버 관리 | SSM Run Command, SSH 포트·키 없음 |

EC2 한 대이므로 장애 시 일시 중단될 수 있다. 서버 재시작 시 웹·알림 서비스는 자동 시작한다.
상태는 S3에 있으므로 프로세스 재시작으로 없어지지 않는다. 장기 AWS 액세스 키를 서버에 넣지 않고 instance role을 사용한다.
공개 IPv4는 Discord·패키지 설치·SSM의 외부 통신용이다. 인바운드는 CloudFront용 보안 그룹으로 제한한다.
EC2/EBS/IPv4 및 S3·CloudFront 사용량에 따른 AWS 요금이 발생하며 크레딧 적용 여부는 별도 확인해야 한다.
NAT Gateway·로드밸런서·RDS는 만들지 않는다. CPU 크레딧은 `standard`로 설정해 초과 CPU 크레딧 요금을 방지한다.

CloudFront는 쿠키·Host·쿼리를 전달하고 캐싱을 끈다. nginx는 원래 HTTPS 주소를 Next에 전달한다.
로그인·보고서·상태 API를 CDN에 저장하지 않는다. 접근 로그에는 OAuth code나 키를 남기지 않는다.

## 지금 필요한 AWS 권한

이전 `GammaruReportsMigration`은 저장소 전용이어서 웹서버 생성 권한이 없다.
추가 정책 [aws-web-deploy-permissions.json](../infra/aws-web-deploy-permissions.json)을
**고객 관리형 정책**으로 만든다. IAM 사용자 인라인 정책 총량 제한 때문에 이번에는 인라인으로 넣지 않는다.

1. AWS 콘솔 → **IAM** → 왼쪽 **정책** → **정책 생성**.
2. **JSON** 탭에서 기본 내용을 지우고 위 JSON 파일 전체를 붙여넣는다.
3. **다음** → 정책 이름 **`GammaruWebDeploy`** → **정책 생성**.
4. IAM → **사용자** → **`dudri-deployer`** → **권한 추가** → **권한 추가**.
5. **직접 정책 연결** → `GammaruWebDeploy` 검색 → 체크 → **다음** → **권한 추가**.
6. 기존 `GammaruReportsMigration` 정책은 유지한다.

정책은 새 `gammaru-web` 스택, 전용 역할, `Project=gammaru-web` 태그의 리소스, 지정 서브넷,
전용 SSM 파라미터에 생성·관리 권한을 준다. 인프라 검색용 읽기 API는 서비스 특성상 `*` 범위가 포함된다.
새 전용 역할에 런타임 정책을 설정하고 EC2에 전달할 수 있는 배포 권한이다. 계정 전체 AdministratorAccess는 필요하지 않다.

## 배포 절차

아래 명령은 저장소 루트에서 실행한다. 기본 실행은 읽기 전용이며 계정 번호도 검사한다.

```powershell
uv run --no-project --with botocore --with python-dotenv python scripts/deploy-aws-web.py
```

권한 적용 후 승인된 이전 작업을 진행할 때:

```powershell
# 전용 인프라 생성. 기존 스택이 있으면 바꾸지 않고 상태만 표시한다.
uv run --no-project --with botocore --with python-dotenv python scripts/deploy-aws-web.py --apply
uv run --no-project --with botocore --with python-dotenv python scripts/deploy-aws-web.py --status
```

CloudFront VPC origin과 배포가 준비될 때까지 `--status`로 확인한다.
CloudFormation 삭제 방지가 켜져 있으며, S3는 스택 외부 리소스로 관리한다.
생성 실패 시 실패 리소스의 원인을 확인한다. 다른 프로젝트의 인프라나 보안 그룹은 수정하지 않는다.

완료 후 코드가 검토·커밋된 깨끗한 작업 폴더에서:

```powershell
uv run --no-project --with botocore --with python-dotenv python scripts/deploy-aws-web.py --release
# 위 명령이 반환한 commandId로 결과를 확인한다.
uv run --no-project --with botocore --with python-dotenv python scripts/deploy-aws-web.py --command-status COMMAND_ID
```

`--release`는 추적된 Git 소스만 압축하고, 환경 파일·세션·실행 데이터를 검사해 제외한다.
Windows node_modules는 보내지 않는다. EC2에서 Linux ARM용으로 의존성을 설치하고 빌드한다.
빌드 시 새 공개 URL을 지정하므로 sitemap·공유 이미지도 AWS 주소를 사용한다.
성공 후 현재 release 링크를 전환하고 웹 건강 상태를 확인한 다음 알림 워커를 재시작한다.
배포가 실패한 release 경로는 임의 삭제하지 않는다. 원인을 확인한 뒤 별도 커밋으로 재시도한다.

환경 값은 로컬 `.env.funding`·`.env.personal`에서 필요한 값만 메모리로 읽어 SSM SecureString으로 전달한다.
Vercel Blob 토큰이나 배포자의 AWS 키는 전달하지 않는다. 터미널·문서·Git·SSM 명령 본문에 키를 출력하지 않는다.
CloudFront가 생성한 관리형 보안 그룹을 확인한 뒤 EC2 인바운드를 그 그룹에만 허용한다.
이는 초기 스택의 prefix-list 규칙보다 좁은 설정이며, 후속 `--apply`가 이를 덮어쓰지 않는다.

## 새 주소가 나온 뒤 전환

`gammarupage.vercel.app`은 Vercel 소유 도메인이므로 AWS에 그대로 붙일 수 없다.
이번에는 새 `https://…cloudfront.net` 주소에서 랜딩과 `/reports`, `/personal`을 함께 제공한다.

1. Discord Developer Portal의 기존 앱 OAuth2 Redirects에 새 주소의 **`/reports/auth/callback`**을 추가한다.
   개인 공간도 같은 callback을 사용한다. 기존 redirect는 이전 사이트 보존을 위해 당장 삭제하지 않는다.
2. 새 `/reports/login/admin`에서 로그인한다. 동아리 회원은 Discord 재로그인 후 다시 승인한다.
   `/personal`은 Discord 로그인만으로 열리며, 진행 버튼과 메모는 Discord 계정별로 새로 시작한다.
3. 두 공간의 publisher 로그인, 업로드 자료·최신 stateVersion, S3 상태 변경, 계정별 분리,
   채널 목적지, 워커 연결 상태를 검증한다. 임의 테스트 메시지나 가짜 보고서를 발행하지 않는다.
4. dots의 기존 두 예약에서 사이트 주소만 새 origin으로 변경하고 다시 로그인한다.
   **한국시간 08시 조사·09시 보고**는 유지한다. 사이트가 실제 반환한 상태를 읽어 새 보고서를 만든다.
5. 첫 실제 발행의 날짜·버전·URL·채널 전송 결과를 확인한다.
6. AWS 검증 후 기존 Dishost 워커를 중지하고 Vercel 발행·정리 예약을 중지한다.
   기존 Vercel Blob 원본은 삭제하지 않는다. 현재 준비 단계에서는 옛 서버·예약을 아직 건드리지 않았다.

### dots 전달문 — URL 확정 후 치환

```text
겜마루와 개인 보고서 사이트를 AWS로 이전했어.
아래 <AWS_URL>을 이번에 확정한 HTTPS 주소로 바꾸고 기존 두 예약에 반영해줘.
새 예약을 중복 생성하지 말고 한국시간 08시 조사·09시 보고를 유지해줘.

겜마루 로그인: <AWS_URL>/reports/login/publisher
겜마루 지침·동아리 정보·디자인·진행 상태: <AWS_URL>/reports/upload?guide=1
겜마루 업로드: <AWS_URL>/reports/upload
개인 로그인: <AWS_URL>/personal/login/publisher
개인 지침·프로필·디자인·진행 상태: <AWS_URL>/personal/upload?guide=1
개인 업로드: <AWS_URL>/personal/upload

AWS는 새 저장소로 시작했으므로 예전 Vercel의 stateVersion·회원·메모가 옮겨졌다고 가정하지 마.
매 실행과 발행 직전에 새 사이트의 최신 지침·현재 상태·당일 발행 여부를 다시 읽어줘.
겜마루는 동아리가 직접 확보할 운영비·후원 물품·장비·공간·단체 자원만 조사해줘.
개인은 개발·AI·IT 공모전과 채용을 조사하고 트레이딩은 제외해줘.
두 보고서의 항목 상태와 보류 기록은 새 사이트에 실제 저장된 자료를 반영해줘.
발행 후 사이트에 설정된 각 채널의 해당 날짜·버전 전송 완료까지 확인해줘.
기존 Vercel 주소에는 업로드하거나 알림을 요청하지 마.
```

## 검증

- `REPORTS_DEPLOY_TARGET=aws NEXT_PUBLIC_SITE_URL=https://dexample.cloudfront.net npm run build`: 검증용 standalone 생성 및 172개 정적 페이지 빌드. 실제 배포는 스크립트가 확정된 주소를 사용한다.
- `node scripts/test-aws-standalone.mjs`: 로컬 가짜 S3를 사용한 실제 Next 실행,
  HTTPS 프록시 헤더, 양쪽 publisher 로그인·쿠키 분리·자료 페이지·CSRF·정적 파일 확인.
- 보고서 테스트 116개 통과: publisher guide·7일 정리·계정 분리·프록시 경계 포함. 수정 파일 ESLint 통과.
- CloudFormation `cfn-lint`, Python 구문 검사, Bash `-n` 검사.
- AWS 실제 배포 및 새 도메인의 OAuth·알림 검증은 추가 권한 적용 후 수행한다.

## 근거

- [Next.js 자체 호스팅](https://nextjs.org/docs/app/guides/self-hosting)
- [CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
- [CloudFront 서비스 연결 역할](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-service-linked-roles.html)
- [Amazon Linux 2023 Node.js](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html)

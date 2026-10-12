# 도트 랜딩 반영

2026-10-12 사용자가 Orca `page change`의 최신 `redesign-pixel` 시안을 선택했다.
시안 원본 폴더는 수정하지 않고 현재 AWS 사이트의 `/`에 통합했다.

- `src/landing/index.html`: 선택한 도트 레이아웃, 모바일 메뉴와 작품 상세 창. 시안용 noindex·제목을 운영 메타데이터로 교체했다.
- `public/landing/`: 시안의 스타일·도트 canvas·영상·게임 필터·역할 탭 스크립트. 로고와 작품·영상은 기존 공개 자산을 사용한다.
- `src/app/route.ts`: 완성 HTML을 정적으로 제공한다. 기존 React 레이아웃과 겹치지 않으며 정적 파일 내용으로 버전을 계산한다.
- `public/landing/session.js`: 기존 `/reports/session`, `/personal/session`을 조회해 로그인한 이용자에게만 해당 보고서 메뉴를 표시한다. 개인 정보·세션을 로컬 저장소에 쓰지 않는다.
- `public/landing/chrome.css`: 메인과 게임 목록·상세·소개·활동·기록 페이지가 공유하는 색상, 반투명 메뉴, 푸터. 내부 페이지에서도 Manrope·Noto Sans KR을 사용한다.
- `src/components/SiteHeader.tsx`: 내부 페이지에도 같은 모달 메뉴를 제공한다. Escape·배경 클릭·페이지 이동 시 닫고, 보고서 및 개인 세션을 함께 조회한다. 홈으로 돌아갈 때는 HTML 문서 전체를 불러와 메뉴·애니메이션을 다시 초기화한다.
- `src/app/interior.css`: 게임 목록·상세·소개·활동·기록의 제목, 여백, 카드와 버튼을 선택된 시안에 맞춘다. 기능과 게임 데이터는 기존 React 페이지를 사용한다.
- `src/components/PixelScene.tsx`: React hydration 뒤 공용 도트 렌더러에 장면을 등록한다. 게임·시즌·상세에는 world, 활동에는 studio, 활동 기록에는 planning, 역할 탭에는 선택한 분야의 장면을 사용한다.
- `public/landing/illustrations.js`: 메인과 내부 페이지가 공유하는 30fps canvas 렌더러. 페이지 이동과 역할 변경 때 장면을 등록·해제하고, 화면 밖·메뉴 뒤·숨긴 탭에서는 재생하지 않는다. 동작 줄이기·데이터 절약 설정에서는 정지된 장면을 표시한다.
- 전체 게임 링크는 현재 사이트의 `/games`에 연결한다. 기존 상세 페이지·보고서·로그인·업로드·알림 경로는 유지한다.

홈은 React 컴포넌트가 아니라 Next Route Handler의 HTML 응답이다. 홈으로 향하는 링크는 일반 `<a href="/">`를 사용한다.
홈 본문 스타일은 해당 HTML에만 로드한다. 공통 메뉴·푸터 스타일만 React 레이아웃에도 가져오며, 보고서 화면은 기존 독립 HTML을 사용한다.
`games.js`의 6개 작품과 `reel.js`의 제작자 정보는 시안의 공개 데이터 스냅샷이다. 작품 선정이나 쇼릴이 바뀌면 `src/data` 원본과 함께 갱신한다.

검증 명령:

```powershell
npm run test:smoke -- http://127.0.0.1:4320
npm run test:reel -- http://127.0.0.1:4320
npm run test:details -- http://127.0.0.1:4320
npm run test:pixels -- http://127.0.0.1:4320
```

smoke는 검색·상세·필터·키보드 탭·메뉴·로그인별 링크·320/390px 및 데스크톱 가로 넘침을 확인한다.
홈·내부 페이지의 로고 및 메뉴 위치 일치, 내부 메뉴의 스크롤 잠금과 포커스 복원, 로그아웃 후 회원 링크 제거도 검사한다.
details는 실제 146개 작품 제목을 6개 화면 폭에서 검사하고 이미지·공식 SNS를 확인한다.
pixels는 실제 canvas 픽셀의 재생·정지, 역할 탭, 내부 페이지 이동 후 중복·분리된 canvas의 그리기 중단, 설정 변경과 320/390/1440px 화면, 메인 장면 재사용을 확인한다.
reel은 실제 영상과 전체 제작자 표시, 모바일 540p, 반복 재생, 화면 밖·메뉴·숨긴 탭에서 정지,
동작 줄이기·데이터 절약 설정과 영상 실패 시 포스터를 확인한다.
기존 `test-hero-reel.mjs`는 이전 React HLS 플레이어의 검증 기록이며 현재 `test:reel`은 도트 시안의 MP4 플레이어를 검사한다.

2026-10-12 내부 페이지 통합 검증: 수정 파일 ESLint와 AWS standalone 빌드(172개 경로),
실제 standalone 서버에서 smoke·details·reel 모두 통과했다. 146개 작품 제목은 320/390/768/1101/1440/1920px에서 넘침이 없었다.
메인 영상 재생 및 정지 조건, 아카이브 검색과 홈 복귀, 로그인 상태별 메뉴와 로그아웃 반영도 확인했다.

2026-10-13 도트·모션 확장 검증: 수정 파일 ESLint, AWS standalone 빌드(172개 경로),
실제 standalone 서버의 pixels·smoke·reel 검증을 통과했다. 320/390px 모바일과 데스크톱에서
장면 배치·역할 전환·페이지 이동·정지 조건을 확인했으며 보고서·알림 데이터는 변경하지 않았다.

# 도트 랜딩 반영

2026-10-12 사용자가 Orca `page change`의 최신 `redesign-pixel` 시안을 선택했다.
시안 원본 폴더는 수정하지 않고 현재 AWS 사이트의 `/`에 통합했다.

- `src/landing/index.html`: 선택한 도트 레이아웃, 모바일 메뉴와 작품 상세 창. 시안용 noindex·제목을 운영 메타데이터로 교체했다.
- `public/landing/`: 시안의 스타일·도트 canvas·영상·게임 필터·역할 탭 스크립트. 로고와 작품·영상은 기존 공개 자산을 사용한다.
- `src/app/route.ts`: 완성 HTML을 정적으로 제공한다. 기존 React 레이아웃과 겹치지 않으며 정적 파일 내용으로 버전을 계산한다.
- `public/landing/session.js`: 기존 `/reports/session`, `/personal/session`을 조회해 로그인한 이용자에게만 해당 보고서 메뉴를 표시한다. 개인 정보·세션을 로컬 저장소에 쓰지 않는다.
- `src/components/SiteHeader.tsx`: 기존 내부 페이지에서 홈으로 돌아갈 때 HTML 문서 전체를 불러와 메뉴·애니메이션을 다시 초기화한다.
- 전체 게임 링크는 현재 사이트의 `/games`에 연결한다. 기존 상세 페이지·보고서·로그인·업로드·알림 경로는 유지한다.

홈은 React 컴포넌트가 아니라 Next Route Handler의 HTML 응답이다. 홈으로 향하는 링크는 일반 `<a href="/">`를 사용한다.
홈 스타일은 해당 HTML에만 로드되므로 아카이브와 보고서 스타일에 영향을 주지 않는다.
`games.js`의 6개 작품과 `reel.js`의 제작자 정보는 시안의 공개 데이터 스냅샷이다. 작품 선정이나 쇼릴이 바뀌면 `src/data` 원본과 함께 갱신한다.

검증 명령:

```powershell
npm run test:smoke -- http://127.0.0.1:4320
npm run test:reel -- http://127.0.0.1:4320
```

smoke는 검색·상세·필터·키보드 탭·메뉴·로그인별 링크·320/390px 및 데스크톱 가로 넘침을 확인한다.
reel은 실제 영상과 전체 제작자 표시, 모바일 540p, 반복 재생, 화면 밖·메뉴·숨긴 탭에서 정지,
동작 줄이기·데이터 절약 설정과 영상 실패 시 포스터를 확인한다.
기존 `test-hero-reel.mjs`는 이전 React HLS 플레이어의 검증 기록이며 현재 `test:reel`은 도트 시안의 MP4 플레이어를 검사한다.

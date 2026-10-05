export const exampleReport = {
  summary: "[화면 검증용 예시] 다음 게임잼을 위한 운영비와 제작 환경 지원을 나누어 검토하세요. 아래 항목은 실제 공고가 아닙니다.",
  searched: ["예시: 대학 게임개발 동아리 운영 지원", "예시: 학생 게임잼 행사 후원"],
  warnings: ["가상 데이터입니다. 실제 기관·지원금·마감일 정보로 사용하지 마세요."],
  opportunities: [
    {
      title: "대학생 창작 동아리 활동 지원", organization: "예시 창작재단 · 실제 공고 아님", kind: "cash", benefit: "활동비 지원 · 예시 금액 미정", deadline: "2099-12-31", eligibility: "likely",
      eligibilityReason: "학생 동아리를 대상으로 하는 가상 예시입니다. 실제 공고에서 동아리 자격과 대학 확인서 조건을 검토해야 합니다.",
      fitReason: "여름·겨울 공모전과 게임잼처럼 함께 완성하는 제작 활동을 중심으로 제안할 수 있습니다.",
      requirements: ["학교 소속 증빙 조건 확인", "게임잼 예산과 사용 계획 준비"], nextSteps: ["동아리 활동 내역과 작품 아카이브를 정리합니다.", "예산 항목별 사용 계획을 준비합니다."],
      sources: [{ url: "https://example.org/funding/student-creation", title: "원문 공고 · 가상 예시 링크", evidence: "실제 근거가 아닌 화면 검증용 예시입니다." }],
      actions: [{ kind: "prepare_brief", title: "게임잼 활동 소개서 준비", recipient: "", subject: "", body: "# 겜마루 활동 소개서 — 검토용 예시\n\n겜마루는 숭실대학교 중앙 게임개발동아리입니다.\n\n## 제안할 활동\n게임잼과 공모전을 통해 팀별로 플레이 가능한 게임을 완성합니다.\n\n## 운영진이 채울 정보\n- 실제 참여 인원\n- 확정된 일정\n- 항목별 예산과 증빙 계획\n\n이 문서는 화면 검증용이며 제출 가능한 완성본이 아닙니다." }],
    },
    {
      title: "학생 게임잼 제작 환경 후원", organization: "예시 게임 파트너 · 실제 공고 아님", kind: "in_kind", benefit: "개발 도구·행사 물품 · 현물", deadline: null, eligibility: "uncertain",
      eligibilityReason: "개별 제작팀과 동아리 전체의 자격을 따로 확인해야 하는 가상 예시입니다.",
      fitReason: "현금 운영비와는 구분하되, 행사 물품과 도구 비용을 줄이는 방향으로 검토할 수 있습니다.",
      requirements: ["후원 조건과 행사 로고 노출 범위 확인", "실제 담당자 주소 확인"], nextSteps: ["공식 후원 문의 창구를 확인합니다.", "후원 요청 범위와 제공할 활동 결과물을 정리합니다."],
      sources: [{ url: "https://example.org/funding/gamejam", title: "후원 안내 · 가상 예시 링크", evidence: "실제 모집 정보가 아닌 디자인 예시입니다." }], actions: [],
    },
  ],
};

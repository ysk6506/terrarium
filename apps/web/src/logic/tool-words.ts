/**
 * The words of choosing tools, asking a person for help and following a runbook (REQ-080~082): kept apart from the
 * screens so a test can hold them to the style rules of the glossary (해요체, 숫자와 단위, "툴", no "장애").
 */
export const TOOL_WORDS = {
  TITLE: "에이전트가 쓸 툴",
  LEDE: "처음에는 현실의 운영팀이 가진 흔한 툴만 켜 있어요. 영역별로 접어 두었으니 필요한 영역만 펼쳐 보세요.",
  SEARCH: "툴 찾기",
  SEARCH_HELP: "툴 이름, 영역, 흔함·드묾·없음으로 찾아요",
  NO_MATCH: "맞는 툴이 없어요",
  NEED_NONE: "시나리오를 고르면 필요한 툴을 알려 줘요",
  NEED_ALL: "필요한 툴이 모두 켜 있어요",
  NEED_BUTTON: "필요한 것만 켜기",
  NEED_SAME: "지금 켜 둔 툴이 이미 필요한 것뿐이에요",
  AREA_ON: "이 영역 전부 켜기",
  AREA_OFF: "이 영역 전부 끄기",
  LOCKED: "진단 제출은 늘 켜 있어요",
  REALISM_HELP: "흔함은 현실의 운영팀이 가진 툴이고, 드묾과 없음은 일부러 켤 때만 써요",
  GRANT_TITLE: "줄 툴 고르기",
  GRANT_LEDE: "이미 가진 툴은 켜 있고 바꿀 수 없어요. 줄 툴만 켜세요",
  need: (n: number) => `이 시나리오에 필요한 툴 ${n}개`,
  missing: (n: number) => `아직 꺼 둔 툴이 ${n}개 있어요`,
  areaCount: (on: number, total: number) => `${on}/${total}개 켬`,
} as const;

export const HUMAN_WORDS = {
  ESC_TITLE: "에스컬레이션 처리",
  ESC_HELP: "에이전트가 사람에게 묻기를 부르면 어떻게 할지 정해요",
  ESC_NEEDS_TOOL: "사람에게 묻기 툴을 켜면 고를 수 있어요",
  ESC_WAIT: "사람 기다림",
  ESC_AUTO: "정해 둔 답으로 자동 응답",
  ESC_FAIL: "실패로 끝냄",
  ESC_REPLY: "정해 둔 답",
  ESC_REPLY_HELP: "에이전트가 물으면 늘 이 글을 돌려줘요",
  SCOPE_TITLE: "고장 범위",
  SCOPE_HELP: "준 툴로 풀 수 없는 고장을 시나리오에서 뺄지 정해요",
  SCOPE_INSIDE: "준 툴 안에서만",
  SCOPE_ALL: "전부",
  SOP_TITLE: "절차서",
  SOP_HELP: "시나리오의 절차서를 에이전트에게 어떻게 줄지 정해요",
  SOP_NONE: "안 줌",
  SOP_GIVEN: "줌",
  SOP_SEARCH: "찾게 함",
  SOP_NO_BOOK: "이 시나리오에는 절차서가 없어요. 시나리오 편집기의 절차서 탭에서 써요",
  SOP_SEARCH_NOTE: "찾게 함을 고르면 절차서 찾기 툴이 같이 켜져요",
} as const;

/** Sentences of the screens above, for the style check. */
export function toolTexts(): string[] {
  const plain = (words: Readonly<Record<string, unknown>>): string[] =>
    Object.values(words).filter((v): v is string => typeof v === "string");
  return [
    ...plain(TOOL_WORDS),
    TOOL_WORDS.need(3),
    TOOL_WORDS.missing(2),
    TOOL_WORDS.areaCount(2, 5),
    ...plain(HUMAN_WORDS),
  ].filter((t) => t.length > 0);
}

/**
 * Where a connection stands on the connections screen and how a harness gets Terrarium's tools (REQ-051, REQ-079,
 * beta feedback 14 to 17). Two kinds of tool address exist: a run address Terrarium makes at the start of every run and
 * hands to the harness (nothing to register), and a slot address that is fixed per connection, for a harness that reads
 * its MCP servers only from its own settings (registered once). The screen says which one a connection has, and keeps
 * the connections of the person first, the built-in reference agents folded away.
 */
import type { ConnectionView, ConnectorSpec } from "@terrarium/core/contract";
import type { KeyValueStore } from "./identity";

export type AddressKind = "run" | "slot" | "none";

export const ADDRESS_LABELS: Readonly<Record<AddressKind, string>> = {
  run: "실행 주소(등록 없음)",
  slot: "슬롯 주소(한 번 등록)",
  none: "함수 호출(주소 없음)",
};

/** Which address a harness uses: a slot when it has one, a run address when its tools come over MCP, else none. */
export function addressKind(info: {
  readonly mcpSlot?: string | undefined;
  readonly mcpSlotUrl?: string | undefined;
  readonly toolTransport: ConnectorSpec["toolTransport"];
}): AddressKind {
  if (info.mcpSlot || info.mcpSlotUrl) return "slot";
  return info.toolTransport === "mcp" ? "run" : "none";
}

/** The connector kinds that read their tools from a fixed slot address (what a card says before anything is connected). */
export const SLOT_CONNECTORS: readonly string[] = ["hermes"];

/** The cards of "어떤 하네스인가요?", in the order people reach for them. The rest wait behind "다른 방식". */
export const KIND_CARDS: ReadonlyArray<{
  readonly kind: string;
  readonly name: string;
  readonly asks: string;
}> = [
  { kind: "http", name: "하네스 프로토콜", asks: "주소 · 토큰" },
  { kind: "opencode", name: "OpenCode", asks: "주소 · 토큰" },
  { kind: "langgraph", name: "LangGraph", asks: "주소 · 토큰" },
  { kind: "goclaw", name: "GoClaw", asks: "주소 · 게이트웨이 토큰" },
  { kind: "hermes", name: "Hermes", asks: "주소 · 토큰" },
  { kind: "http-template", name: "HTTP API", asks: "OpenAI 호환 · 간단 JSON" },
];

/** Connections the person made or the server lists, apart from the built-in reference agents. */
export function splitConnections(views: readonly ConnectionView[]): {
  readonly mine: readonly ConnectionView[];
  readonly reference: readonly ConnectionView[];
} {
  return {
    mine: views.filter((v) => v.connector !== "scripted"),
    reference: views.filter((v) => v.connector === "scripted"),
  };
}

/** The agents whose name holds the words typed, for the search box on a connection's card. */
export function matchAgents<
  T extends { readonly name: string; readonly model?: string | undefined },
>(agents: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q
    ? agents.filter((a) => `${a.name} ${a.model ?? ""}`.toLowerCase().includes(q))
    : [...agents];
}

/** How many agents show before "모두 보기": a line, not a page. */
export const AGENT_PREVIEW = 5;

/** "에이전트 37개 · 3개 보이는 중" style summary for the one-line agent row. */
export function agentLine(view: Pick<ConnectionView, "census" | "agents">): string {
  const total = view.census.total || view.agents.length;
  return total === 0 ? "에이전트가 없어요" : `에이전트 ${total}개`;
}

/** The last path piece of a slot address is its token. */
export function slotToken(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? "";
}

/** The address with the token cut short, so it can be shown without being read over a shoulder. */
export function shortSlotUrl(url: string): string {
  const token = slotToken(url);
  return token.length > 8 ? url.replace(token, `${token.slice(0, 4)}…${token.slice(-4)}`) : url;
}

const REGISTERED = "terrarium.slot-registered.";

/** Whether this browser was told the slot address is registered in the harness. */
export function slotRegistered(store: Pick<KeyValueStore, "getItem"> | undefined, slot: string) {
  try {
    return store?.getItem(`${REGISTERED}${slot}`) === "1";
  } catch {
    return false;
  }
}

export function markSlotRegistered(
  store: Pick<KeyValueStore, "setItem" | "removeItem"> | undefined,
  slot: string,
  on: boolean,
): void {
  try {
    if (on) store?.setItem(`${REGISTERED}${slot}`, "1");
    else store?.removeItem(`${REGISTERED}${slot}`);
  } catch {
    // a browser that refuses storage just asks again next time
  }
}

/** What stops an experiment from starting: a slot address nobody told Terrarium is registered. */
export const SLOT_PENDING_PROBLEM = "툴 주소를 하네스에 한 번 등록하고 확인해 주세요";

export const MCP_WORDS = {
  SLOT_HEAD: "연결하고 슬롯 주소를 한 번만 등록해요",
  SLOT_DONE: "등록돼 있어요 ✓",
  SLOT_TODO: "아직 등록 안 했어요",
  SLOT_HELP:
    '이 연결의 고정 주소예요. 한 번만 등록하면 모든 실험에 쓰여요. 이미 등록했으면 여기엔 "등록돼 있어요 ✓"만 보여요.',
  RUN_TEXT: "실행을 시작하면 주소가 생겨요 · 등록 없음",
  RUN_HELP: "테라리움이 실행마다 새 툴 주소를 만들어 하네스에 넘겨요. 직접 등록할 것이 없어요.",
  NONE_TEXT: "이 연결은 툴 주소가 필요 없어요 · 등록 없음",
  DIFF_SUMMARY: "실행 주소와 슬롯 주소가 뭐가 달라요?",
  DIFF_RUN:
    "실행 주소(/mcp/runs/…)는 실행을 시작할 때마다 테라리움이 새로 만들어 하네스에 넘겨요. 그 실행의 툴만 열려서, 사람이 등록할 것이 없어요.",
  DIFF_SLOT:
    "슬롯 주소(/mcp/slots/…)는 연결마다 하나로 고정돼 있어요. 설정 파일에서만 MCP 서버를 읽는 하네스는 실행마다 주소를 받을 수 없어서, 이 주소를 한 번 등록해 두어요. 실험이 돌 때만 그 실행의 세계로 이어져요.",
  CHECK: "등록했어요 · 연결 확인하기",
  CHECKED_OK: "연결을 확인했어요. 등록돼 있다고 표시해 뒀어요",
  UNREGISTER: "다시 등록할래요",
} as const;

/** The three steps for putting a slot address into a harness, in the harness's own words where they are known. */
export function registerSteps(kind: string, harnessName: string): readonly string[] {
  if (kind === "hermes")
    return [
      "Hermes 설정 파일(config.yaml)을 열어요",
      "mcp_servers → terrarium → url에 위 주소를 붙여 넣어요",
      "필요하면 Hermes를 다시 시작해서 툴 목록을 읽게 해요",
    ];
  return [
    `${harnessName} 관리 화면 → 설정 → MCP 서버 → 추가`,
    '종류는 "Streamable HTTP", 주소에는 위 값을 붙여 넣어요',
    '쓸 에이전트의 툴에서 "terrarium"을 켜요',
  ];
}

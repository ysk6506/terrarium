/**
 * The connections screen's order and words (REQ-051, REQ-079, beta feedback 14 to 17): which tool address a connection
 * has, my connections before the reference agents, an agent line that searches, and the registration of a slot address.
 */
import type { ConnectionView } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { scenario as sc } from ".";
import {
  ADDRESS_LABELS,
  addressKind,
  agentLine,
  KIND_CARDS,
  MCP_WORDS,
  markSlotRegistered,
  matchAgents,
  registerSteps,
  SLOT_CONNECTORS,
  shortSlotUrl,
  slotRegistered,
  slotToken,
  splitConnections,
} from "./connection-places";
import { draftProblems } from "./experiment";

const view = (connector: string, extra: Partial<ConnectionView> = {}) =>
  ({ id: connector, connector, agents: [], ...extra }) as unknown as ConnectionView;

describe("the tool address a connection uses [REQ-051] [REQ-079]", () => {
  test("a slot when the harness has one, a run address when tools come over MCP, else none", () => {
    expect(addressKind({ toolTransport: "mcp", mcpSlot: "team" })).toBe("slot");
    expect(addressKind({ toolTransport: "mcp", mcpSlotUrl: "https://x/mcp/slots/a/b" })).toBe(
      "slot",
    );
    expect(addressKind({ toolTransport: "mcp" })).toBe("run");
    expect(addressKind({ toolTransport: "function-calling" })).toBe("none");
    expect(ADDRESS_LABELS.run).toBe("실행 주소(등록 없음)");
    expect(ADDRESS_LABELS.slot).toBe("슬롯 주소(한 번 등록)");
  });

  test("the cards are the six harnesses, and the slot kinds are named", () => {
    expect(KIND_CARDS.map((c) => c.name)).toEqual([
      "하네스 프로토콜",
      "OpenCode",
      "LangGraph",
      "GoClaw",
      "Hermes",
      "HTTP API",
    ]);
    expect(SLOT_CONNECTORS).toContain("hermes");
  });
});

describe("my connections come first, the reference agents are folded [REQ-051] [REQ-079]", () => {
  test("scripted connections are the reference agents; everything else is mine to talk to", () => {
    const { mine, reference } = splitConnections([
      view("scripted"),
      view("goclaw"),
      view("hermes"),
    ]);
    expect(mine.map((v) => v.connector)).toEqual(["goclaw", "hermes"]);
    expect(reference.map((v) => v.connector)).toEqual(["scripted"]);
  });

  test("the agent search matches the name or the model, in any case", () => {
    const agents = [
      { name: "ops-agent-07", model: "claude-sonnet" },
      { name: "Triage", model: "gpt" },
    ];
    expect(matchAgents(agents, "OPS")).toHaveLength(1);
    expect(matchAgents(agents, "gpt")).toHaveLength(1);
    expect(matchAgents(agents, "  ")).toHaveLength(2);
    expect(matchAgents(agents, "없는")).toEqual([]);
  });

  test("the agent line is a count, or says there are none", () => {
    const census = (total: number) => ({ total }) as ConnectionView["census"];
    expect(agentLine({ census: census(37), agents: [] })).toBe("에이전트 37개");
    expect(agentLine({ census: census(0), agents: [] })).toBe("에이전트가 없어요");
  });
});

describe("a slot address is registered once [REQ-051] [REQ-079]", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  test("the mark is kept per slot and can be taken back; a missing store just says no", () => {
    const s = store();
    expect(slotRegistered(s, "team")).toBe(false);
    markSlotRegistered(s, "team", true);
    expect(slotRegistered(s, "team")).toBe(true);
    expect(slotRegistered(s, "other")).toBe(false);
    markSlotRegistered(s, "team", false);
    expect(slotRegistered(s, "team")).toBe(false);
    expect(slotRegistered(undefined, "team")).toBe(false);
  });

  test("the token is the last piece of the address, and the short form hides the middle of it", () => {
    const url = "https://terrarium.internal/mcp/slots/team-goclaw/9f3a1b2c3d4e5f60c21e";
    expect(slotToken(url)).toBe("9f3a1b2c3d4e5f60c21e");
    expect(shortSlotUrl(url)).toBe("https://terrarium.internal/mcp/slots/team-goclaw/9f3a…c21e");
  });

  test("an experiment on an unregistered slot waits, and says why in the step's own line", () => {
    const draft = { harnessId: "h", agentId: "a", runs: 5 } as never;
    expect(draftProblems(draft, ["a"], undefined, true).who).toEqual([
      "툴 주소를 하네스에 한 번 등록하고 확인해 주세요",
    ]);
    expect(draftProblems(draft, ["a"], undefined, false).who).toEqual([]);
  });

  test("the steps are the harness's own for Hermes and named after the harness otherwise", () => {
    expect(registerSteps("hermes", "내 Hermes")[1]).toMatch(/mcp_servers/);
    expect(registerSteps("goclaw", "팀 GoClaw")[0]).toMatch(/^팀 GoClaw 관리 화면/);
  });
});

describe("the words follow the glossary [REQ-071] [REQ-079]", () => {
  const RETIRED = ["장애", "주입", "해제", "도구", "삭제", "수정", "취소", "월드", "경보", "노출"];
  const texts = [
    ...Object.values(MCP_WORDS),
    ...Object.values(ADDRESS_LABELS),
    ...registerSteps("goclaw", "GoClaw"),
    ...registerSteps("hermes", "Hermes"),
    ...sc.QUESTIONS.flatMap((q) => [q.title, q.hint]),
    ...Object.values(sc.SCORE_LABELS),
  ];

  test("no retired word, no stiff ending", () => {
    for (const t of texts) {
      for (const w of RETIRED) expect(t, w).not.toContain(w);
      expect(t).not.toMatch(/(습니다|입니다)/);
    }
  });
});

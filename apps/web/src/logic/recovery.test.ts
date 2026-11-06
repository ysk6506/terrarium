import type { Score } from "@terrarium/core/oracle";
import { TEMPLATE_GROUPS } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  commonPathNote,
  NO_COMMON_PATH_TEXT,
  probeLines,
  recoveryFigures,
  scoringText,
} from "./recovery";
import { startGroups } from "./scenario";

const recovery = {
  services: ["portal"],
  impairedAt: 600,
  recoveredAt: 780,
  endAt: 900,
  recovered: true,
  byAgent: true,
  seconds: 180,
  agentSeconds: 60,
  fixAfterSeconds: 30,
  worsened: [] as string[],
  acts: 1,
  costKrw: 1_000_000,
  delayHours: 0,
};

const scored = (
  over: Partial<typeof recovery> = {},
  scoring: Score["scoring"] = "recovery",
): Score => ({
  version: "3",
  scoring,
  recovery: { ...recovery, ...over },
  total: 100,
  earned: 100,
  penalty: 0,
  possible: 100,
  passed: true,
  items: [],
  summary: "",
});

describe("the result of a scenario with services starts with how the services did [REQ-088]", () => {
  test("recovery time, whether it recovered without a person, and whether it got worse", () => {
    const figures = recoveryFigures(scored());
    expect(figures.slice(0, 3).map((f) => [f.label, f.value])).toEqual([
      ["서비스 복구 시간", "3분"],
      ["사람 없이 복구한 비율", "복구됨"],
      ["복구 중 악화", "없음"],
    ]);
    expect(figures[3]).toMatchObject({ label: "사고 비용(추정)", value: "100만 원" });
  });

  test("a run that did not recover, and one that made things worse, say so", () => {
    const lost = recoveryFigures(scored({ recovered: false, byAgent: false, worsened: ["queue"] }));
    expect(lost.map((f) => f.value).slice(0, 3)).toEqual(["복구 못 함", "안 됨", "있음"]);
    expect(lost[2]?.hint).toContain("1개");
  });

  test("a batch service shows the delay, and a run with no cost shows zero won", () => {
    expect(recoveryFigures(scored({ costKrw: 0, delayHours: 1.5 }))[3]?.value).toBe("1.5시간 지연");
    expect(recoveryFigures(scored({ costKrw: 0 }))[3]?.value).toBe("0원");
  });

  test("a score as written has no such numbers, and the sheet says which scoring it had", () => {
    expect(recoveryFigures(scored({}, "classic"))).toEqual([]);
    expect(recoveryFigures(undefined)).toEqual([]);
    expect(scoringText(scored())).toBe("복구 우선 채점");
    expect(scoringText(scored({}, "classic"))).toBe("항목별 채점");
  });

  test("the words are the glossary's: no 장애, numbers with units, 해요체", () => {
    const text = recoveryFigures(scored({ worsened: ["a"] }))
      .flatMap((f) => [f.label, f.value, f.hint])
      .join("\n");
    expect(text).not.toContain("장애");
    expect(text).toMatch(/\d+분/);
    expect(text).not.toMatch(/(합니다|한다)(\.|$)/m);
  });
});

describe("a scenario the common tools do not reach says so [REQ-088]", () => {
  test("only when they did not reach it", () => {
    expect(commonPathNote({ reached: false, calls: 16, via: [] })).toBe(NO_COMMON_PATH_TEXT);
    expect(commonPathNote({ reached: true, calls: 2, via: ["list_alarms"] })).toBeUndefined();
    expect(commonPathNote(undefined)).toBeUndefined();
    expect(NO_COMMON_PATH_TEXT).toBe("흔한 툴만으로는 원인에 닿을 수 없어요");
  });

  test("a template card carries the note for the templates named", () => {
    const index = new BlueprintIndex({
      schemaVersion: 1,
      id: "w",
      name: "w",
      entities: [],
      links: [],
      meta: {},
    });
    const first = TEMPLATE_GROUPS[0]?.templates[0];
    expect(first).toBeDefined();
    const groups = startGroups(TEMPLATE_GROUPS, index, new Set([first?.id as string]));
    const cards = groups.flatMap((g) => g.cards);
    // a card the world cannot use is explained by why, not by the tools
    expect(cards.find((c) => c.id === first?.id)?.note).toBeUndefined();
    const usable = startGroups(
      [
        {
          id: "g",
          label: "g",
          templates: [{ ...(first as object), unavailable: () => undefined } as never],
        },
      ],
      index,
      new Set([first?.id as string]),
    );
    expect(usable[0]?.cards[0]?.note).toBe(NO_COMMON_PATH_TEXT);
  });

  test("the variance check lists the way to move a service and the way to the cause", () => {
    const lines = probeLines(
      {
        applicable: true,
        ok: true,
        how: "failover_service",
        note: "서비스를 대기 쪽으로 옮기면 돌아와요",
      },
      { reached: true, calls: 3, via: ["list_alarms", "get_entity"] },
    );
    expect(lines.map((l) => [l.label, l.good])).toEqual([
      ["서비스를 옮겨서 복구하는 길", true],
      ["흔한 툴만으로 원인에 닿는 길", true],
    ]);
    expect(lines[1]?.value).toBe("있어요. 알람 목록 → 장비 상세, 3번");
    expect(probeLines({ applicable: false, ok: true, note: "" }, undefined)).toEqual([]);
    const none = probeLines(undefined, { reached: false, calls: 16, via: [] });
    expect(none[0]).toMatchObject({ good: false });
  });
});

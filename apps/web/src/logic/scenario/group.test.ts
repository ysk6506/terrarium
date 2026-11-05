import type { Condition } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../../../../packages/core/src/world/test-support/sample-campus";
import {
  conditionLine,
  type Group,
  groupSummary,
  OPEN_GROUP_LIMIT,
  startsCollapsed,
  valueForField,
} from "./group";

const index = new BlueprintIndex(campusBlueprint());
const servers = index.ofKind("server");

const powered = (entity: string): Condition => ({
  kind: "state",
  entity,
  field: "powered",
  op: "==",
  value: true,
});
const all = (of: Condition[]): Group => ({ kind: "all", of });

describe("a big condition folds into one line [REQ-034]", () => {
  test("a group of up to three children stays open, a bigger one starts folded", () => {
    expect(OPEN_GROUP_LIMIT).toBe(3);
    expect(servers.length).toBeGreaterThan(4);
    const ids = servers.map((s) => s.id);
    expect(startsCollapsed(all(ids.slice(0, 3).map(powered)))).toBe(false);
    expect(startsCollapsed(all(ids.slice(0, 4).map(powered)))).toBe(true);
    expect(startsCollapsed({ kind: "diagnosis_submitted" })).toBe(false);
  });

  test("the folded line says it in words: how many servers and what they all do", () => {
    const group = all(servers.map((s) => powered(s.id)));
    expect(groupSummary(group, index)).toBe(`서버 ${servers.length}대가 모두 전원 공급`);
    const nested = all([
      all(servers.slice(0, 2).map((s) => powered(s.id))),
      all(servers.slice(2).map((s) => powered(s.id))),
    ]);
    expect(groupSummary(nested, index)).toBe(`서버 ${servers.length}대가 모두 전원 공급`);
    expect(conditionLine(nested, index)).toBe("");
    const some: Group = { kind: "any", of: servers.map((s) => powered(s.id)) };
    expect(groupSummary(some, index)).toBe(`서버 ${servers.length}대 중 하나라도 전원 공급`);
  });

  test("a mixed group names its first condition and counts the rest; a short one reads in full", () => {
    const mixed = all([
      powered(servers[0]?.id as string),
      powered(servers[1]?.id as string),
      { kind: "alarm", active: false },
      { kind: "diagnosis_submitted" },
    ]);
    expect(groupSummary(mixed, index)).toMatch(/ 외 3개가 모두 맞을 때$/);
    const short = all([powered(servers[0]?.id as string)]);
    expect(conditionLine(short, index)).toContain("전원 공급");
  });

  test("a yes/no field keeps a yes/no value when the field changes", () => {
    const id = servers[0]?.id as string;
    expect(valueForField(index, id, "powered", 30)).toBe(true);
    expect(valueForField(index, id, "powered", false)).toBe(false);
    expect(valueForField(index, id, "inletC", true)).toBe(0);
  });
});

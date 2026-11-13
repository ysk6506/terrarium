import type { AgentHistoryView, AgentVersionView } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  addRequest,
  canEditVersions,
  changeText,
  editRequest,
  type Pending,
  pendingOf,
  versionFormOf,
  versionTitle,
} from "./agent-versions";
import { metaProblems } from "./connections";

const version = (n: number, over: Partial<AgentVersionView> = {}): AgentVersionView => ({
  n,
  at: "2026-10-30T01:00:00Z",
  source: "auto",
  attributes: {},
  snapshot: {},
  changes: [],
  experiments: 0,
  ...over,
});
const history = (over: Partial<AgentHistoryView> = {}): AgentHistoryView => ({
  harnessId: "h",
  agentId: "a",
  versions: [version(3), version(2)],
  ...over,
});

describe("what a person fills in to add or annotate a version [REQ-053]", () => {
  test("an empty form sends only the attributes; a written one sends what was written, trimmed", () => {
    expect(addRequest(versionFormOf())).toEqual({ attributes: {} });
    const form = {
      label: "  프롬프트 v3 ",
      note: "시스템 프롬프트에 규칙 두 줄을 더했다 ",
      attributes: [
        { key: "prompt", value: "v3" },
        { key: " ", value: "버려진다" },
      ],
    };
    expect(addRequest(form)).toEqual({
      label: "프롬프트 v3",
      note: "시스템 프롬프트에 규칙 두 줄을 더했다",
      attributes: { prompt: "v3" },
    });
  });

  test("editing a version starts from what it has, and a name or note left empty is removed", () => {
    const form = versionFormOf(
      version(2, { label: "기준", note: "처음", attributes: { prompt: "v2" } }),
    );
    expect(form).toEqual({
      label: "기준",
      note: "처음",
      attributes: [{ key: "prompt", value: "v2" }],
    });
    expect(editRequest(form)).toEqual({
      label: "기준",
      note: "처음",
      attributes: { prompt: "v2" },
    });
    expect(editRequest({ ...form, label: " ", note: "" })).toEqual({
      label: null,
      note: null,
      attributes: { prompt: "v2" },
    });
  });

  test("rows with a name that cannot be used or no value are pointed at by their row", () => {
    expect(
      metaProblems([
        { key: "ok", value: "1" },
        { key: "나쁜 이름!", value: "1" },
        { key: "빈값", value: " " },
        { key: "", value: "버려진다" },
      ]),
    ).toEqual({
      "meta.1": "이름은 글자·숫자·._-로 40자까지 쓸 수 있어요",
      "meta.2": "값을 적어 주세요",
    });
  });
});

describe("a version history reads in words [REQ-053]", () => {
  test("a version is called by its number, and its name when it has one", () => {
    expect(versionTitle({ n: 3 })).toBe("v3");
    expect(versionTitle({ n: 3, label: "프롬프트 v3" })).toBe("v3 · 프롬프트 v3");
  });

  test("a field that was added or removed says so instead of showing nothing", () => {
    expect(changeText({ field: "model", label: "모델", before: "a", after: "b" })).toEqual({
      before: "a",
      after: "b",
    });
    expect(changeText({ field: "fact.x", label: "x", after: "1" }).before).toBe("(없었어요)");
    expect(changeText({ field: "fact.x", label: "x", before: "1" }).after).toBe("(없어졌어요)");
  });

  test("the next experiment: the first version, a new one with its changes, no change, or unknown", () => {
    const first = pendingOf(history({ versions: [], pending: { first: true, changes: [] } }));
    expect(first).toMatchObject<Partial<Pending>>({ tone: "plain" });
    expect(first.text).toContain("v1이 생겨요");

    const change = { field: "model", label: "모델", before: "a", after: "b" };
    const changed = pendingOf(history({ pending: { first: false, changes: [change] } }));
    expect(changed.tone).toBe("warn");
    expect(changed.text).toContain("v3");
    expect(changed.changes).toEqual([change]);

    const same = pendingOf(history());
    expect(same.tone).toBe("good");
    expect(same.text).toContain("v3과 같아요");
    expect(pendingOf(history({ versions: [] })).text).toBe("지금은 버전이 없어요.");

    const down = pendingOf(history({ pendingError: "연결이 끊겼다" }));
    expect(down.tone).toBe("warn");
    expect(down.text).toContain("연결이 끊겼다");
  });

  test("versions are changed by the one who connected it and by administrators; the server's file's connections only by administrators", () => {
    expect(canEditVersions({ source: "config" }, "하늘", false)).toBe(false);
    expect(canEditVersions({ source: "config" }, "하늘", true)).toBe(true);
    expect(canEditVersions({ source: "screen", owner: "하늘" }, "하늘", false)).toBe(true);
    expect(canEditVersions({ source: "screen", owner: "하늘" }, "민수", false)).toBe(false);
    expect(canEditVersions({ source: "screen", owner: "하늘" }, "민수", true)).toBe(true);
    expect(canEditVersions({ source: "screen", owner: "하늘" }, undefined, false)).toBe(false);
    expect(canEditVersions(undefined, "하늘", true)).toBe(false);
  });
});

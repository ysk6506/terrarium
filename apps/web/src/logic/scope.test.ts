import type { LlmModelView, MetaView } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  blockedWords,
  defaultNote,
  emptyFilterText,
  matchesFilter,
  ownerName,
  peopleNames,
  repeatedNames,
  sameScope,
  scopeBody,
  scopeFilters,
  scopeOptions,
  scopeSentence,
  scopeTag,
  whoLine,
} from "./scope";

const meta = (over: Partial<MetaView> = {}): MetaView =>
  ({
    user: { id: "haneul", name: "김하늘", groups: ["part-a"], roles: ["user"], source: "proxy" },
    identity: { mode: "proxy" },
    people: [{ id: "minsu", name: "박민수" }],
    ...over,
  }) as MetaView;

describe("who can see a thing, in words [REQ-054]", () => {
  test("[REQ-054] the question has three answers, and 우리 파트 is absent when there is no group", () => {
    expect(scopeOptions(["part-a"]).map((o) => o.label)).toEqual(["나만", "우리 파트", "모두"]);
    expect(scopeOptions([]).map((o) => o.label)).toEqual(["나만", "모두"]);
    // an administrator looking at something already shared that way still sees it
    expect(scopeOptions([], { scope: "group", group: "part-a" })).toHaveLength(3);
  });

  test("[REQ-054] a group answer names a group the person is in, and the others name none", () => {
    expect(scopeBody({ scope: "group", group: "part-b" }, ["part-a"])).toEqual({
      scope: "group",
      group: "part-a",
    });
    expect(scopeBody({ scope: "private", group: "part-a" }, ["part-a"])).toEqual({
      scope: "private",
    });
    expect(sameScope({ scope: "group", group: "a" }, { scope: "group", group: "b" })).toBe(false);
    expect(sameScope({ scope: "private", group: "a" }, { scope: "private" })).toBe(true);
  });

  test("[REQ-054] a list is quiet about 모두 and says the rest", () => {
    expect(scopeTag({ scope: "everyone" })).toBeUndefined();
    expect(scopeTag({})).toBeUndefined();
    expect(scopeTag({ scope: "private" })).toBe("나만");
    expect(scopeTag({ scope: "group", group: "part-a" })).toBe("우리 파트 · part-a");
    expect(scopeSentence({ scope: "group", group: "part-a" })).toContain("part-a");
  });

  test("[REQ-054] the filter is by 내 것, 우리 파트 or 모두, and 우리 파트 needs a group", () => {
    expect(scopeFilters(true).map((f) => f.label)).toEqual(["전부", "내 것", "우리 파트", "모두"]);
    expect(scopeFilters(false).map((f) => f.label)).toEqual(["전부", "내 것", "모두"]);
    const mine = { owner: "haneul", scope: "private" as const };
    const theirs = { owner: "minsu", scope: "group" as const };
    expect(matchesFilter("mine", mine, "haneul")).toBe(true);
    expect(matchesFilter("mine", theirs, "haneul")).toBe(false);
    expect(matchesFilter("mine", mine, undefined)).toBe(false);
    expect(matchesFilter("group", theirs, "haneul")).toBe(true);
    expect(matchesFilter("everyone", { owner: "x" }, "haneul")).toBe(true);
    expect(matchesFilter("everyone", mine, "haneul")).toBe(false);
    expect(emptyFilterText("group")).toContain("우리 파트");
    expect(emptyFilterText("all")).toBe("");
  });
});

describe("names and the known defects [REQ-054]", () => {
  test("[REQ-054] an owner is shown by the name the server heard, else by the id", () => {
    const names = peopleNames(meta());
    expect(ownerName("minsu", names)).toBe("박민수");
    expect(ownerName("haneul", names)).toBe("김하늘");
    expect(ownerName("stranger", names)).toBe("stranger");
    expect(peopleNames(undefined).size).toBe(0);
  });

  test("[REQ-054] models with the same name are found, so their owners can be shown", () => {
    expect(repeatedNames([{ name: "빠른" }, { name: "느린" }, { name: "빠른" }])).toEqual(
      new Set(["빠른"]),
    );
    expect(repeatedNames([{ name: "a" }, { name: "b" }]).size).toBe(0);
  });

  test("[REQ-054] a model that cannot be the default says what to change", () => {
    const view = (scope: string, canChange: boolean) =>
      ({ sharing: { scope, canChange } }) as unknown as LlmModelView;
    expect(defaultNote(view("everyone", true))).toEqual({ canSet: true });
    expect(defaultNote(view("private", true)).why).toContain("모두");
    expect(defaultNote(view("private", false))).toEqual({ canSet: false });
  });

  test("[REQ-054] a refusal says the reason and what can be done", () => {
    expect(blockedWords(404)?.title).toBe("볼 수 없어요");
    expect(blockedWords(404)?.body).toContain("나만");
    expect(blockedWords(403)?.body).toContain("복제");
    expect(blockedWords(500)).toBeUndefined();
  });

  test("[REQ-054] the rail says who is signed in, and that a typed name has no authority", () => {
    expect(whoLine(meta(), undefined)).toMatchObject({ name: "김하늘", unsafe: false });
    const typed = meta({ identity: { mode: "self-declared" } as MetaView["identity"] });
    expect(whoLine(typed, "하늘")).toMatchObject({ name: "하늘", unsafe: true });
    expect(whoLine(typed, "하늘")?.note).toContain("권한이 없는 방식");
    expect(whoLine(undefined, undefined)).toBeUndefined();
  });
});

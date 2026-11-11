import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { canSee, may, mustSee, sightOf, standing } from "./permissions";
import { ADMIN, person, YEONSU } from "./test-support/platform";

const member = { ...person("mina", "proxy"), groups: ["part-a"] };
const outsider = { ...person("omar", "proxy"), groups: ["part-b"] };
const maker = { ...YEONSU, groups: ["part-a"] };

const WHO = [
  ["maker", maker],
  ["member of its group", member],
  ["someone in another group", outsider],
  ["an admin", ADMIN],
] as const;

describe("the read rule: who sees a resource [REQ-054]", () => {
  const cases: readonly [string, object, readonly boolean[]][] = [
    ["private", { scope: "private" }, [true, false, false, true]],
    ["group", { scope: "group", group: "part-a" }, [true, true, false, true]],
    ["everyone", { scope: "everyone" }, [true, true, true, true]],
    ["no scope at all (an old record)", {}, [true, true, true, true]],
  ];
  test.each(cases)("[REQ-054] %s", (_name, scoping, expected) => {
    WHO.forEach(([, who], i) => {
      const r = standing({ owner: YEONSU.id, ...scoping });
      expect(may(who, "see", r).ok).toBe(expected[i]);
      expect(canSee(who, r)).toBe(expected[i]);
    });
  });

  test("[REQ-054] a resource nobody made and without a scope is open to every signed-in person", () => {
    expect(canSee(outsider, {})).toBe(true);
  });

  test("[REQ-054] seeing something that is not allowed answers like not found", () => {
    expect(() => mustSee(outsider, { owner: "yeonsu", scope: "private" }, "세계")).toThrow(
      NotFoundError,
    );
    expect(() => mustSee(maker, { owner: "yeonsu", scope: "private" }, "세계")).not.toThrow();
  });

  test("[REQ-054] using needs sight, and the person's sight carries the id, the groups and the admin role", () => {
    expect(may(outsider, "use", { owner: "yeonsu", scope: "private" }).ok).toBe(false);
    expect(may(member, "use", { owner: "yeonsu", scope: "group", group: "part-a" }).ok).toBe(true);
    expect(sightOf(ADMIN).admin).toBe(true);
    expect(sightOf(member)).toEqual({ id: "mina", groups: ["part-a"], admin: false });
  });
});

describe("changing the scope, and listing the links [REQ-054]", () => {
  test.each(["changeScope", "listShares"] as const)(
    "[REQ-054] %s is for the maker and an admin",
    (action) => {
      const r = standing({ owner: YEONSU.id, scope: "everyone" });
      expect(may(maker, action, r).ok).toBe(true);
      expect(may(ADMIN, action, r).ok).toBe(true);
      expect(may(member, action, r).ok).toBe(false);
      expect(may(outsider, action, r).ok).toBe(false);
    },
  );
});

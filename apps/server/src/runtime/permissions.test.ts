import { ForbiddenError } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { ANONYMOUS, NOBODY } from "./context";
import { allow, may } from "./permissions";
import { ADMIN, HANEUL, JIMIN, person } from "./test-support/platform";

const mine = { owner: HANEUL.id };
const MAKER_OR_ADMIN = [
  "change",
  "remove",
  "cancel",
  "addRuns",
  "answerEscalation",
  "calibrate",
  "editProcess",
  "createShare",
] as const;

describe("the one place that decides who may do what [REQ-054]", () => {
  test.each(MAKER_OR_ADMIN)(
    "[REQ-054] %s is for the maker and an admin, not another signed-in person",
    (action) => {
      expect(may(HANEUL, action, mine)).toEqual({ ok: true });
      expect(may(ADMIN, action, mine)).toEqual({ ok: true });
      const refused = may(JIMIN, action, mine);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).toContain(HANEUL.id);
    },
  );

  test("[REQ-054] a thing nobody made (the config file's) is changed by admins only", () => {
    expect(may(ADMIN, "change", {}).ok).toBe(true);
    expect(may(HANEUL, "change", {}).ok).toBe(false);
    expect(may(HANEUL, "editAgentVersions", {}).ok).toBe(false);
    expect(may(ADMIN, "editAgentVersions", {}).ok).toBe(true);
  });

  test("[REQ-054] using a connection: anyone signed in for the config file's, the maker and admins for one made on the screen", () => {
    expect(may(JIMIN, "use", {}).ok).toBe(true);
    expect(may(JIMIN, "use", mine).ok).toBe(false);
    expect(may(HANEUL, "use", mine).ok).toBe(true);
    expect(may(ADMIN, "use", mine).ok).toBe(true);
  });

  test("[REQ-054] a share link may be taken back by its maker, the experiment's maker or an admin", () => {
    const link = { owner: HANEUL.id, creator: ADMIN.id };
    expect(may(ADMIN, "deleteShare", link).ok).toBe(true);
    expect(may(HANEUL, "deleteShare", link).ok).toBe(true);
    expect(may(JIMIN, "deleteShare", link).ok).toBe(false);
    expect(may(JIMIN, "deleteShare", { ...link, creator: JIMIN.id }).ok).toBe(true);
  });

  test("[REQ-054] administering is for admins; liking is for anyone who has said who they are", () => {
    expect(may(ADMIN, "administer").ok).toBe(true);
    expect(may(HANEUL, "administer").ok).toBe(false);
    expect(may(JIMIN, "like").ok).toBe(true);
    expect(may(ANONYMOUS, "like").ok).toBe(false);
  });

  test("[REQ-054] a caller with no role is refused everything, and an admin of one thing is not an owner of another", () => {
    for (const action of [...MAKER_OR_ADMIN, "use", "like", "administer"] as const)
      expect(may(NOBODY, action, mine).ok, action).toBe(false);
    expect(may(person("sam", "proxy", ["user"]), "change", { owner: "samuel" }).ok).toBe(false);
  });

  test("[REQ-054] the same person under another display name is the same owner: ownership is the login id", () => {
    const renamed = { ...HANEUL, name: "김하늘" };
    expect(may(renamed, "change", mine).ok).toBe(true);
    expect(may({ ...JIMIN, name: HANEUL.id }, "change", mine).ok).toBe(false);
  });

  test("[REQ-054] a refusal reaches the caller as a 403 that names the thing", () => {
    expect(() => allow(JIMIN, "remove", mine, "세계 지우기")).toThrow(ForbiddenError);
    expect(() => allow(JIMIN, "remove", mine, "세계 지우기")).toThrow("세계 지우기는 만든 사람");
    expect(() => allow(HANEUL, "remove", mine, "세계 지우기")).not.toThrow();
  });
});

/**
 * The reason an administrator gives for changing what is another person's (permissions.md section 7, ADR-0198): it comes as
 * the header `x-terrarium-reason`, is kept in the entry's `detail.reason` for an administrator only, and is cleaned first. The
 * same file holds the names the server has heard, which lists use instead of login ids.
 */
import { afterAll, describe, expect, test } from "vitest";
import { People } from "../runtime";
import { reasonOf } from "./audit-http";
import { allEntries } from "./test-support/audit-support";
import { type AuditedApp, auditedApp } from "./test-support/audited-app";
import { BOSS, makeAll, OLIVIA, type Person } from "./test-support/scoped-app";

const s: AuditedApp = auditedApp();
afterAll(() => s.close());

const made = await makeAll(s, OLIVIA, { scope: "everyone" });

async function putScope(who: Person, reason: string | undefined) {
  const mark = (await allEntries(s.audit)).at(-1)?.seq ?? 0;
  const res = await s.app.inject({
    method: "PUT",
    url: `/api/worlds/${made.world.id}/scope`,
    headers: {
      "x-terrarium-proxy-secret": "proxy-secret-for-scope-tests-0001",
      "x-forwarded-user": who.login,
      "x-forwarded-groups": who.groups.join(","),
      ...(reason === undefined ? {} : { "x-terrarium-reason": reason }),
    },
    payload: { scope: "private" },
  });
  const entries = (await allEntries(s.audit)).filter((e) => e.seq > mark);
  return { res, entries };
}

describe("the reason an administrator writes [REQ-054]", () => {
  test("[REQ-054] an administrator's reason is kept in the entry, decoded", async () => {
    const { res, entries } = await putScope(
      BOSS,
      encodeURIComponent("담당자가 바뀌어서 닫아 둬요"),
    );
    expect(res.statusCode).toBe(200);
    const entry = entries.find((e) => e.action === "scope.change");
    expect(entry?.detail).toMatchObject({ reason: "담당자가 바뀌어서 닫아 둬요" });
  });

  test("[REQ-054] the maker's own change keeps no reason, even if one is sent", async () => {
    await s.send(OLIVIA, "PUT", `/api/worlds/${made.world.id}/scope`, { scope: "everyone" });
    const { entries } = await putScope(OLIVIA, "나는 이유를 안 써도 돼요");
    const entry = entries.find((e) => e.action === "scope.change");
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.detail ?? {})).not.toContain("이유");
  });

  test("[REQ-054] a reason that is not a reason is left out", () => {
    expect(reasonOf(undefined)).toBeUndefined();
    expect(reasonOf("   ")).toBeUndefined();
    expect(reasonOf("%E0%A4%A")).toBeUndefined();
    expect(reasonOf(encodeURIComponent("a\u0000b\nc"))).toBe("a b c");
    expect(reasonOf("x".repeat(500))?.length).toBe(200);
    expect(reasonOf(["첫째", "둘째"])).toBe("첫째");
  });
});

describe("the names people go by [REQ-054]", () => {
  const viewer = (id: string, name: string, source: "proxy" | "anonymous" = "proxy") => ({
    id,
    name,
    groups: [],
    roles: ["user" as const],
    source,
  });

  test("[REQ-054] a name is heard from a signed-in person; an id given back as a name says nothing more", () => {
    const people = new People();
    people.hear(viewer("haneul", "김하늘"));
    people.hear(viewer("minsu", "minsu"));
    people.hear(viewer("anonymous", "anonymous", "anonymous"));
    expect(people.all()).toEqual([{ id: "haneul", name: "김하늘" }]);
  });

  test("[REQ-054] the quietest are forgotten first, and the list never grows past its cap", () => {
    const people = new People();
    for (let i = 0; i < 520; i += 1) people.hear(viewer(`u${i}`, `이름 ${i}`));
    const all = people.all();
    expect(all).toHaveLength(500);
    expect(all.some((p) => p.id === "u0")).toBe(false);
    expect(all.some((p) => p.id === "u519")).toBe(true);
  });

  test("[REQ-054] the meta carries the list, empty while every name is only a login id", async () => {
    const meta = (await s.send(OLIVIA, "GET", "/api/meta")).body as { people?: unknown[] };
    expect(meta.people).toEqual([]);
  });
});

/**
 * When the audit log cannot be written (ADR-0193, permissions.md section 6): a change is not made and the person is told so
 * in words; a read is served; a refusal stays a refusal; and the failure is counted and logged without anything of the entry.
 */
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { auditMetricsText, DONE_UNRECORDED, NOT_DONE } from "../runtime";
import { FlakyAuditStore } from "./test-support/audit-support";
import { auditedApp } from "./test-support/audited-app";
import { BOSS, OLIVIA, OMAR } from "./test-support/scoped-app";

const store = new FlakyAuditStore();
const lines: { action: string; outcome: string }[] = [];
const s = auditedApp({ audit: store, auditLine: (l) => lines.push(l) });
afterAll(() => s.close());

beforeEach(() => {
  store.failing = false;
  store.appendFailing = false;
  lines.length = 0;
});

const create = (name: string) =>
  s.send(OLIVIA, "POST", "/api/worlds", { name, blueprint: sampleBlueprint(), scope: "private" });
const worldNames = async () =>
  ((await s.send(OLIVIA, "GET", "/api/worlds")).body as unknown as { name: string }[]).map(
    (w) => w.name,
  );

describe("the log cannot be written [REQ-054]", () => {
  test("[REQ-054] a change is refused before it is made, in words that say what to do, and nothing is changed", async () => {
    store.failing = true;
    const r = await create("안 만들어질 세계");
    expect(r.status).toBe(503);
    expect(r.text).toContain(NOT_DONE);
    expect(NOT_DONE).toMatch(/다시 해 보시고/);
    store.failing = false;
    expect(await worldNames()).not.toContain("안 만들어질 세계");
  });

  test("[REQ-054] a read is served, and the failure is counted and logged as an action and an outcome", async () => {
    const before = s.platform.audit.counts().failures;
    store.failing = true;
    const read = await s.send(BOSS, "GET", "/api/audit?limit=3");
    expect(read.status).toBe(200);
    expect(s.platform.audit.counts().failures).toBeGreaterThan(before);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(["action", "outcome"]);
  });

  test("[REQ-054] a refusal stays a refusal when the log is down", async () => {
    store.failing = true;
    expect((await s.send(OMAR, "GET", "/api/audit")).status).toBe(403);
    expect((await s.send(OLIVIA, "DELETE", "/api/worlds/w-none")).status).not.toBe(200);
  });

  test("[REQ-054] if only the write fails, after the check passed, the person is told the work is done but unrecorded", async () => {
    store.appendFailing = true;
    const r = await create("끝났지만 기록 못 한 세계");
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).toContain(DONE_UNRECORDED);
    store.appendFailing = false;
    expect(await worldNames()).toContain("끝났지만 기록 못 한 세계");
  });

  test("[REQ-054] the log lines hold only the action and the outcome, never the error of the disk or the name typed", async () => {
    store.failing = true;
    await create("로그에 없어야 할 이름");
    await s.send(OLIVIA, "GET", "/api/worlds");
    const text = JSON.stringify(lines);
    expect(text).not.toContain("secret-path-in-error");
    expect(text).not.toContain("disk full");
    expect(text).not.toContain("로그에 없어야 할 이름");
    expect(text).not.toContain("olivia");
  });

  test("[REQ-054] it works again when the log does, and the counters say what happened", async () => {
    const r = await create("다시 되는 세계");
    expect(r.status).toBe(200);
    const text = auditMetricsText(s.platform.audit.counts());
    expect(text).toContain(
      'terrarium_audit_entries_total{action="world.create",outcome="allowed"}',
    );
    expect(text).toMatch(/terrarium_audit_write_failures_total [1-9]/);
    expect(text).not.toContain("olivia");
    const admin = await s.send(BOSS, "GET", "/api/audit?action=world.create&limit=50");
    expect(JSON.stringify(admin.body)).toContain("다시 되는 세계");
  });
});

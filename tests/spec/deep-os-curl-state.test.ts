/**
 * What `curl` against a service shows when the host under it is sick (REQ-098, REQ-100): the answer is made from the
 * state of the service and the cause on its hosts, in the words and exit codes the real tool has.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const URL = "http://licd:8701/healthz";
type Sick = [
  fault: Parameters<ReturnType<typeof lab>["inject"]>[0],
  params: Record<string, number>,
  seconds: number,
];

const sick = (...[fault, params, seconds]: Sick) => {
  const l = lab();
  l.inject(fault, "srv-a2", params);
  l.physics.run(seconds);
  return l;
};

describe("curl answers by the state of the service and the cause on its host [REQ-098] [REQ-100]", () => {
  test("a healthy service answers 200 in about 38 ms", () => {
    const l = lab();
    expect(l.sh(`curl -sI ${URL}`)).toContain("X-Response-Time: 38ms");
    expect(l.sh(`curl -s ${URL}`)).toBe('{"status":"ok"}');
  });

  test.each<[string, Sick]>([
    ["a full disk", ["disk_full", {}, 900]],
    ["a file system that went read-only", ["fs_readonly", {}, 900]],
    ["a flood of logs", ["log_flood", { pctPerMin: 10 }, 1800]],
  ])("%s is an answer of 500 with no body", (_, args) => {
    const l = sick(...args);
    expect(l.sh(`curl -sI ${URL}`).split("\n")[0]).toBe("HTTP/1.1 500 Internal Server Error");
    expect(l.sh(`curl -s ${URL}`)).toBe("");
  });

  test.each<[string, Sick]>([
    ["a process that keeps crashing", ["process_crashloop", {}, 900]],
    ["a pile of zombies", ["zombie_pileup", { perMin: 600 }, 3600]],
  ])("%s is a refused connection, exit code 7", (_, args) => {
    const l = sick(...args);
    const r = l.run("srv-a2", `curl -sS ${URL}`);
    expect(r.exitCode).toBe(7);
    expect(r.stderr).toBe("curl: (7) Failed to connect to licd port 8701: Connection refused");
  });

  test("a name server that is gone is a name that cannot be resolved, exit code 6, and an address still works", () => {
    const l = sick("dns_failure", {}, 900);
    const r = l.run("srv-a2", `curl -sS ${URL}`);
    expect(r.exitCode).toBe(6);
    expect(r.stderr).toBe("curl: (6) Could not resolve host: licd");
    expect(l.run("srv-a2", "curl -sS http://10.0.0.11:8701/healthz").exitCode).not.toBe(6);
  });

  test("a clock that drifts or a certificate that ran out slows the answer to 2.3 seconds and says degraded", () => {
    for (const args of [
      ["ntp_drift", { secPerMin: 600 }, 3600],
      ["cert_expired", {}, 60],
    ] as Sick[]) {
      const l = sick(...args);
      expect(l.sh(`curl -sI ${URL}`)).toContain("X-Response-Time: 2310ms");
      expect(l.sh(`curl -s ${URL}`)).toBe('{"status":"degraded"}');
    }
  });

  test("a host that panicked cannot be logged in to, which is a timed-out connection with exit code 255", () => {
    const l = sick("kernel_panic", { downSeconds: 1800 }, 300);
    const r = l.run("srv-a2", `curl -s ${URL}`);
    expect(r.exitCode).toBe(255);
    expect(r.stderr).toContain("ssh: connect to host srv-a2 port 22: Connection timed out");
  });

  test("localhost is the first service of the host, and a port nothing listens on is refused", () => {
    const l = lab();
    expect(l.run("srv-a2", "curl -sS http://localhost:8701/healthz").exitCode).toBe(0);
    expect(l.run("srv-a2", "curl -sS http://localhost:9999/").exitCode).toBe(7);
  });
});

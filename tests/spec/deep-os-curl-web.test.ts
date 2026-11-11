/**
 * curl against a request service (the portal) when the host under it has a clock, a name server or a certificate
 * gone wrong (REQ-098, REQ-100): a request service stops at once on these, and the answer is the one nginx or the TLS
 * library gives. Plus the output options of curl that pick what is shown.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

type Fault = Parameters<ReturnType<typeof lab>["inject"]>[0];

function sick(fault: Fault, params: Record<string, number>, seconds: number) {
  const l = lab();
  l.inject(fault, "vm-web", params);
  l.physics.run(seconds);
  return l;
}

describe("a request service stopped by its host's clock, name server or certificate [REQ-098] [REQ-100]", () => {
  test("an expired certificate is a TLS error, exit code 60", () => {
    const r = sick("cert_expired", {}, 120).run("srv-a2", "curl -sS http://portal/");
    expect(r).toMatchObject({
      exitCode: 60,
      stderr: "curl: (60) SSL certificate problem: certificate has expired",
    });
  });

  test("a clock that is far off is a 401 that says negotiate, and the reason is in a header", () => {
    const l = sick("ntp_drift", { secPerMin: 600 }, 3600);
    const head = l.sh("curl -sI http://portal/").split("\n");
    expect(head[0]).toBe("HTTP/1.1 401 Unauthorized");
    expect(head).toContain("WWW-Authenticate: Negotiate");
    expect(head).toContain("X-Reason: clock skew too great");
  });

  test("a name server that is gone is a 502 from the gateway, and -f turns it into exit code 22", () => {
    const l = sick("dns_failure", {}, 900);
    expect(l.sh("curl -sI http://portal/").split("\n")[0]).toBe("HTTP/1.1 502 Bad Gateway");
    expect(l.run("srv-a2", "curl -sf http://portal/").exitCode).toBe(22);
  });
});

describe("curl prints what the options ask for [REQ-098]", () => {
  test("-o /dev/null hides the body and -w prints the code after it", () => {
    const { sh } = lab();
    expect(sh("curl -s -o /dev/null -w '%{http_code}\\n' http://portal/")).toBe("200");
  });

  test("-s hides a failure, -S shows it again, and without -s it is shown", () => {
    const l = lab();
    l.inject("dns_failure", "srv-a2", {});
    l.physics.run(900);
    const url = "http://licd:8701/healthz";
    expect(l.run("srv-a2", `curl -s ${url}`).stderr).toBe("");
    expect(l.run("srv-a2", `curl -sS ${url}`).stderr).toContain("Could not resolve");
    expect(l.run("srv-a2", `curl ${url}`).stderr).toContain("Could not resolve");
    expect(l.run("srv-a2", `curl --silent --show-error ${url}`).exitCode).toBe(6);
  });

  test("a user name in the address and a path are not part of the host, and a missing URL is a usage error", () => {
    const { sh, run } = lab();
    expect(sh("curl -s http://ops@portal/path?x=1")).toContain('"status":"ok"');
    expect(run("srv-a2", "curl -s").exitCode).toBe(2);
    expect(run("srv-a2", "curl -s -X POST http://portal/").outside).toHaveLength(1);
  });
});

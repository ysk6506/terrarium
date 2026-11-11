/**
 * Other ways an operator ends a clock or name-server fault on a host (REQ-098, REQ-100): starting the stopped unit
 * again, and writing the resolver file with a good name server, the way a person would by hand.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const MINUTE = 60;

describe("starting a stopped unit and rewriting a file end the fault under it [REQ-098] [REQ-100]", () => {
  test("a chronyd that was stopped and started again ends a clock drift", () => {
    const { sh, inject, physics } = lab();
    inject("ntp_drift", "srv-a2", { secPerMin: 120 });
    physics.run(6 * MINUTE);
    expect(sh("chronyc tracking | grep Leap")).toContain("Not synchronised");
    sh("systemctl stop chronyd");
    sh("systemctl start chronyd");
    expect(sh("chronyc tracking | grep Leap")).toContain("Normal");
  });

  test("a resolver file with a good name server ends a DNS failure and the resolver says which one it uses", () => {
    const { sh, inject, physics } = lab();
    inject("dns_failure", "srv-a2");
    physics.run(MINUTE);
    expect(sh("cat /etc/resolv.conf | grep nameserver")).toBe("nameserver 10.20.99.53");
    sh("echo 'nameserver 10.20.0.53' > /etc/resolv.conf");
    expect(sh("cat /etc/resolv.conf")).toBe("nameserver 10.20.0.53");
    expect(sh("journalctl -u systemd-resolved -n 1")).toContain("Using DNS server 10.20.0.53.");
  });

  test("a resolver file with a dead name server changes nothing", () => {
    const { sh, inject, physics } = lab();
    inject("dns_failure", "srv-a2");
    physics.run(MINUTE);
    sh("echo 'nameserver 10.20.99.53' > /etc/resolv.conf");
    expect(sh("journalctl -u systemd-resolved -n 1")).not.toContain("Using DNS server");
  });
});

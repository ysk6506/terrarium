/**
 * What an operator's action on a host's operating system does when it carries less than the shell gives it (REQ-087,
 * ADR-0091; the shell on top is REQ-098): a removal with no byte count, a file written with no text, a signal with no
 * number, a name the host does not have, and a restart that ends a fault of the system under it.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("host actions that carry no data [REQ-087]", () => {
  test("[REQ-087] write with no text makes an empty file, and a symbolic link with no target is made", () => {
    const { sh, world } = lab();
    world.apply({ type: "host.act", target: "srv-a2", action: "write", arg: "/tmp/w" }, "operator");
    expect(sh("cat /tmp/w | wc -c")).toBe("0");
    expect(sh("ls /tmp")).toContain("w");
    world.apply(
      { type: "host.act", target: "srv-a2", action: "symlink", arg: "/tmp/l" },
      "operator",
    );
    expect(sh("ls /tmp")).toContain("l");
  });

  test("[REQ-087] remove with no byte count takes the file away and frees nothing, truncate leaves it empty", () => {
    const { sh, world } = lab();
    const before = sh("df / | tail -1");
    expect(sh("ls /tmp")).toContain("licd-upload.tmp");
    world.apply(
      { type: "host.act", target: "srv-a2", action: "truncate", arg: "/tmp/licd-upload.tmp" },
      "operator",
    );
    expect(sh("stat -c %s /tmp/licd-upload.tmp")).toBe("0");
    world.apply(
      { type: "host.act", target: "srv-a2", action: "remove", arg: "/tmp/licd-upload.tmp" },
      "operator",
    );
    expect(sh("ls /tmp")).not.toContain("licd-upload.tmp");
    expect(sh("df / | tail -1")).toBe(before);
  });

  test("[REQ-087] a name the host does not have is left alone: no process to restart, no unit to enable", () => {
    const { sh, world } = lab();
    const status = sh("systemctl is-enabled sshd");
    for (const action of ["restart", "stop", "start", "enable", "disable"] as const) {
      expect(() =>
        world.apply({ type: "host.act", target: "srv-a2", action, arg: "nosuch" }, "operator"),
      ).not.toThrow();
    }
    expect(sh("systemctl is-enabled sshd")).toBe(status);
    expect(sh("systemctl is-active sshd")).toBe("active");
  });

  test("[REQ-087] a kill with no signal number is a polite one, and a pid the host does not have is ignored", () => {
    const { sh, world } = lab();
    const pid = sh("systemctl show sshd -p MainPID").replace("MainPID=", "");
    world.apply({ type: "host.act", target: "srv-a2", action: "kill", arg: "99999:9" }, "operator");
    expect(sh("systemctl is-active sshd")).toBe("active");
    world.apply({ type: "host.act", target: "srv-a2", action: "kill", arg: pid }, "operator");
    expect(sh("systemctl is-active sshd")).toBe("inactive");
  });

  test("[REQ-087] starting a unit that already runs changes nothing, and nothing is logged", () => {
    const { sh, world } = lab();
    world.apply({ type: "host.act", target: "srv-a2", action: "start", arg: "sshd" }, "operator");
    expect(sh("journalctl --no-pager | grep -c 'Started sshd.service.'")).toBe("0");
    world.apply({ type: "host.act", target: "srv-a2", action: "stop", arg: "sshd" }, "operator");
    world.apply({ type: "host.act", target: "srv-a2", action: "start", arg: "sshd" }, "operator");
    expect(sh("journalctl --no-pager | grep -c 'Started sshd.service.'")).toBe("1");
  });
});

describe("a restart that ends a fault of the system [REQ-087]", () => {
  test("[REQ-087] starting the resolver again ends a DNS failure, starting the clock service ends a drift", () => {
    const { sh, run, inject, physics, world } = lab();
    inject("dns_failure", "srv-a2");
    inject("ntp_drift", "srv-a2", { secPerMin: 120 });
    physics.run(300);
    expect(run("srv-a2", "dig +short srv-a2").exitCode).toBe(9);
    expect(sh("timedatectl show")).toContain("NTPSynchronized=no");
    for (const unit of ["systemd-resolved", "chronyd"]) {
      world.apply({ type: "host.act", target: "srv-a2", action: "stop", arg: unit }, "operator");
      world.apply({ type: "host.act", target: "srv-a2", action: "start", arg: unit }, "operator");
    }
    physics.run(30);
    expect(sh("dig +short srv-a2")).toBe("10.0.0.11");
    expect(sh("timedatectl show")).toContain("NTPSynchronized=yes");
  });

  test("[REQ-087] a VM shows its own CPU use in the process table, and the host action needs a server or a VM", () => {
    const { sh, world } = lab();
    expect(sh("ps -eo pid,%cpu", "vm-web")).toContain("PID %CPU");
    expect(() =>
      world.apply({ type: "host.act", target: "tor-a", action: "reboot" }, "operator"),
    ).toThrow("'tor-a' has no operating system");
    expect(() =>
      world.apply({ type: "host.act", target: "srv-a2", action: "explode" as never }, "operator"),
    ).toThrow("'explode' is not a host action");
  });
});

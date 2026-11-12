/**
 * find and systemctl of the deep operating-system fake (REQ-098, ADR-0117 decision 4): find walks the fake file system with
 * the tests the real one has (name, type, size, age, owner, depth) and acts on what it finds; systemctl reads and changes
 * the units of the host and refuses in the real tool's words.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("find walks the fake file system [REQ-098]", () => {
  test("-name and -iname match on the file name, -type picks files or directories, depth limits cut the walk", () => {
    const { sh } = lab();
    expect(sh("find /etc -name '*.conf'")).toBe(
      "/etc/chrony.conf\n/etc/licd.conf\n/etc/logrotate.conf\n/etc/resolv.conf\n/etc/systemd/resolved.conf",
    );
    expect(sh("find /etc -name '*.conf' -type f")).toBe(sh("find /etc -name '*.conf'"));
    expect(sh("find /etc -type d")).toBe(
      "/etc\n/etc/logrotate.d\n/etc/ssl\n/etc/ssl/certs\n/etc/systemd\n/etc/systemd/system",
    );
    expect(sh("find /etc -maxdepth 1 -name 'h*'")).toBe("/etc/hostname\n/etc/hosts");
    expect(sh("find /etc -mindepth 2 -maxdepth 2")).toBe(
      "/etc/logrotate.d/licd\n/etc/ssl/certs\n/etc/systemd/resolved.conf\n/etc/systemd/system",
    );
    expect(sh("find /etc/systemd -iname 'LICD*'")).toBe("/etc/systemd/system/licd.service");
    expect(sh("find /etc -iname 'HOSTS'")).toBe("/etc/hosts");
    expect(sh("find /etc/hostname")).toBe("/etc/hostname");
    expect(sh("find . -maxdepth 1")).toBe(".\n./.bashrc\n./.ssh");
    expect(sh("find /etc -type l")).toBe("");
  });

  test("-size, -mtime, -mmin and -newer select by size and age", () => {
    const { sh } = lab();
    expect(sh("find /var/log -size +10M").split("\n")).toContain("/var/log/messages");
    expect(sh("find /var/log -size +1G")).toBe("");
    expect(sh("find /var/log -size -100k")).toContain("/var/log/dmesg");
    expect(sh("find /var/log -size +1c -type f -name 'cron'")).toBe("/var/log/cron");
    expect(sh("find /var/log -mtime -1")).toContain("/var/log/messages");
    expect(sh("find /var/log -mtime -1")).not.toContain("messages-20251221");
    expect(sh("find /var/log -mtime +1")).toContain("/var/log/messages-20251221");
    expect(sh("find /var/log -mmin -5")).toContain("/var/log/cron");
    expect(sh("find /var/log -newer /etc/hostname")).toContain("/var/log/cron-20251221");
    expect(sh("find /var/log -newer /etc/hostname")).not.toContain("dmesg");
  });

  test("-user selects by owner, -ls prints the long form, -print is the default", () => {
    const { sh } = lab();
    expect(sh("find /etc -user root -maxdepth 1 -name hosts")).toBe("/etc/hosts");
    expect(sh("find /etc -name 'hosts' -ls")).toBe(
      "-rw-r--r-- 1 root     root             75 Dec 17 17:08 /etc/hosts",
    );
    expect(sh("find /var/log -name 'cron*' -print")).toBe("/var/log/cron\n/var/log/cron-20251221");
  });

  test("-exec runs a command for each hit, -delete removes them", () => {
    const { sh } = lab();
    expect(sh("find /etc -name hosts -exec cat {} ;")).toBe(
      "127.0.0.1 localhost localhost.localdomain\n10.0.0.11 srv-a2 srv-a2.dc.local",
    );
    expect(sh("find /var/log -name '*.log' -exec ls {} ;")).toContain("/var/log/licd/licd.log");
    sh("find /var/log -type f -name 'cron*' -delete");
    expect(sh("find /var/log -name 'cron*'")).toBe("");
  });

  test("a missing place is named, and an operator or test the fake does not have is outside it", () => {
    const { run } = lab();
    expect(run("srv-a2", "find /nope")).toMatchObject({
      stderr: "find: '/nope': No such file or directory",
      exitCode: 1,
    });
    // ADR-0184: -print0 is the real find's and the fake lacks it; the others are mistakes the real find refuses itself
    expect(run("srv-a2", "find /etc -print0").outside).toEqual(["find -print0"]);
    for (const word of ["-perm", "-regex", "-printf"])
      expect(run("srv-a2", `find /etc ${word}`).outside).toEqual([`find ${word}`]);
    for (const word of ["-o", "!", "-x"]) {
      const r = run("srv-a2", `find /etc ${word}`);
      expect(r.outside, word).toEqual([]);
      expect(r.exitCode, word).toBe(1);
      expect(r.stderr, word).not.toContain("terrarium:");
    }
  });
});

describe("systemctl reads and changes the units [REQ-098]", () => {
  test("status prints the unit the way systemd does, for a running one, and says so when there is none", () => {
    const { sh, run } = lab();
    const lines = sh("systemctl status sshd").split("\n");
    expect(lines[0]).toBe("● sshd.service - sshd");
    expect(lines[1]).toBe(
      "     Loaded: loaded (/etc/systemd/system/sshd.service; enabled; preset: disabled)",
    );
    expect(lines[2]).toContain("Active: active (running) since");
    expect(lines[3]).toBe("   Main PID: 457 (sshd)");
    expect(sh("systemctl status chronyd crond")).toContain("● crond.service - crond");
    expect(run("srv-a2", "systemctl status nope")).toMatchObject({
      stderr: "Unit nope.service could not be found.",
      exitCode: 4,
    });
  });

  test("is-active, is-enabled and is-failed answer in one word, with the exit code scripts read", () => {
    const { run } = lab();
    expect(run("srv-a2", "systemctl is-active licd")).toMatchObject({
      stdout: "active",
      exitCode: 0,
    });
    expect(run("srv-a2", "systemctl is-active nope")).toMatchObject({
      stdout: "inactive",
      exitCode: 3,
    });
    expect(run("srv-a2", "systemctl is-enabled licd")).toMatchObject({
      stdout: "enabled",
      exitCode: 0,
    });
    expect(run("srv-a2", "systemctl is-failed licd")).toMatchObject({
      stdout: "active",
      exitCode: 1,
    });
  });

  test("list-units lists the services, --failed only the failed ones", () => {
    const { sh } = lab();
    const all = sh("systemctl list-units --type=service").split("\n");
    expect(all[0]).toBe("  UNIT                     LOAD   ACTIVE     SUB          DESCRIPTION");
    expect(all).toContain("7 loaded units listed.");
    expect(sh("systemctl list-units")).toBe(sh("systemctl list-units --type=service"));
    expect(sh("systemctl --failed")).toBe(
      "  UNIT LOAD ACTIVE SUB DESCRIPTION\n0 loaded units listed.",
    );
  });

  test("stop makes the unit inactive with exit 3 and the stop shows in its status; start brings it back", () => {
    const { sh, run } = lab();
    sh("systemctl stop licd");
    expect(run("srv-a2", "systemctl is-active licd")).toMatchObject({
      stdout: "inactive",
      exitCode: 3,
    });
    const status = run("srv-a2", "systemctl status licd");
    expect(status.exitCode).toBe(3);
    expect(status.stdout).toContain("○ licd.service - EDA 라이선스 서버");
    expect(status.stdout).toContain("Active: inactive (dead)");
    sh("systemctl start licd");
    expect(run("srv-a2", "systemctl status licd").stdout).toContain("licd.service");
    expect(run("srv-a2", "systemctl restart licd").exitCode).toBe(0);
    expect(run("srv-a2", "systemctl reload licd").exitCode).toBe(0);
  });

  test("enable and disable print what systemd prints; cat prints the unit file; show prints properties", () => {
    const { sh } = lab();
    expect(sh("systemctl enable licd")).toBe(
      "Created symlink /etc/systemd/system/multi-user.target.wants/licd.service → /etc/systemd/system/licd.service.",
    );
    expect(sh("systemctl disable licd")).toBe(
      'Removed "/etc/systemd/system/multi-user.target.wants/licd.service".',
    );
    expect(sh("systemctl cat licd").split("\n")[0]).toBe("# /etc/systemd/system/licd.service");
    expect(sh("systemctl cat licd")).toContain(
      "ExecStart=/opt/app/bin/licd --config /etc/licd.conf",
    );
    expect(sh("systemctl show licd").split("\n")[0]).toBe("Id=licd.service");
    expect(sh("systemctl show licd -p MainPID")).toMatch(/^MainPID=\d+$/);
    expect(sh("systemctl daemon-reload")).toBe("");
  });

  test("a unit that is not there, and a verb the fake does not have, are refused", () => {
    const { run } = lab();
    expect(run("srv-a2", "systemctl restart nope")).toMatchObject({
      stderr: "Failed to restart nope.service: Unit nope.service not found.",
      exitCode: 5,
    });
    // ADR-0184: these verbs are systemd's and the fake lacks them; `foo` is no verb, and systemctl says so itself
    for (const verb of ["list-unit-files", "mask", "kill licd", "reset-failed", "list-timers"])
      expect(run("srv-a2", `systemctl ${verb}`)).toMatchObject({
        exitCode: 2,
        outside: [`systemctl ${verb.split(" ")[0]}`],
      });
    expect(run("srv-a2", "systemctl foo")).toMatchObject({ exitCode: 1, outside: [] });
    expect(run("srv-a2", "systemctl status").outside).toEqual([
      "systemctl status (유닛 이름 없이)",
    ]);
    expect(run("srv-a2", "systemctl -n 3 status sshd").outside).toEqual(["systemctl -n"]);
  });
});

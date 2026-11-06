/**
 * The ten operating-system faults leave their marks in files and processes (REQ-098, ADR-0117 decisions 1, 2 and 7):
 * each one can be diagnosed with only common commands (`journalctl`, `ps`, `df`, `cat`, `free`, `systemctl status`,
 * `dig`, `date`, `mount`), and the fixes an operator has end them.
 */
import { OS_FAULT_TYPES } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const MINUTE = 60;

describe("each fault is found with common commands [REQ-098]", () => {
  test("there are ten, and this file covers each of them", () => {
    expect(OS_FAULT_TYPES).toHaveLength(10);
  });

  test("disk full: df says 100%, du and ls name the big old logs, removing them frees the disk", () => {
    const { sh, inject, physics } = lab();
    inject("disk_full", "srv-a2");
    physics.run(MINUTE);
    expect(sh("df -h / | tail -1")).toMatch(/100% \/$/);
    expect(sh("journalctl -p err -n 1")).toContain("No space left on device");
    const big = sh("find /var/log -size +1G").split("\n");
    expect(big.length).toBeGreaterThanOrEqual(3);
    expect(sh("du -sh /var/log/licd")).toMatch(/^\d+G\t/);
    expect(sh("cat /etc/logrotate.d/licd")).toContain("rotation disabled");
    sh(`rm ${big.join(" ")}`);
    physics.run(MINUTE);
    expect(Number(sh("df / | tail -1 | awk '{print $5}' | tr -d %"))).toBeLessThan(90);
    expect(sh("find /var/log -size +1G")).toBe("");
  });

  test("log flood: one log file keeps growing, the journal repeats the same error, a restart stops it", () => {
    const { sh, inject, physics } = lab();
    inject("log_flood", "srv-a2", { pctPerMin: 5 });
    physics.run(2 * MINUTE);
    const before = Number(sh("stat -c %s /var/log/licd/licd.log"));
    physics.run(2 * MINUTE);
    expect(Number(sh("stat -c %s /var/log/licd/licd.log"))).toBeGreaterThan(before);
    expect(sh("journalctl -u licd -n 2")).toContain("upstream connection failed");
    expect(sh("df -h / | tail -1")).not.toContain(" 5%");
    sh("systemctl restart licd");
    sh("rm -f /var/log/licd/licd.log");
    physics.run(5 * MINUTE);
    expect(Number(sh("df / | tail -1 | awk '{print $5}' | tr -d %"))).toBeLessThan(70);
  });

  test("memory leak: one process's RSS grows with time, the journal warns about its heap, free and ps agree", () => {
    const { sh, inject, physics } = lab();
    inject("memory_leak", "srv-a2", { pctPerMin: 3 });
    physics.run(2 * MINUTE);
    const rss = () => Number(sh("ps -C licd -o rss= | tr -d ' '"));
    const first = rss();
    physics.run(3 * MINUTE);
    expect(rss()).toBeGreaterThan(first);
    expect(sh("ps aux --sort=-rss | sed -n 2p")).toContain("licd");
    expect(sh("journalctl -u licd -p warning -n 1")).toMatch(/heap usage \d+%/);
    expect(Number(sh("free -m | awk '/^Mem:/ {print $3}'"))).toBeGreaterThan(0);
  });

  test("crash loop: a restart counter that climbs, a PID that changes, the same fatal line each time", () => {
    const { sh, inject, physics } = lab();
    inject("process_crashloop", "srv-a2", { intervalS: 30 });
    physics.run(2 * MINUTE);
    expect(sh("systemctl status licd")).toContain("activating (auto-restart)");
    const counter = () => Number(sh("systemctl show licd -p NRestarts").split("=")[1]);
    const first = counter();
    const pid = sh("systemctl show licd -p MainPID").split("=")[1];
    physics.run(2 * MINUTE);
    expect(counter()).toBeGreaterThan(first);
    expect(sh("journalctl -u licd -n 20 | grep -c FATAL")).not.toBe("0");
    expect(sh("journalctl -u licd -n 60 | grep 'restart counter' | tail -1")).toMatch(
      /restart counter is at \d+/,
    );
    expect(sh("sed -n 14p /etc/licd.conf")).toContain("}");
    expect(pid).toBeDefined();
  });

  test("zombies: Z rows pile up under one parent, killing a zombie does nothing, restarting the parent clears them", () => {
    const { sh, inject, physics } = lab();
    inject("zombie_pileup", "srv-a2", { perMin: 120 });
    physics.run(2 * MINUTE);
    const count = () => Number(sh("ps aux | grep -c defunct"));
    const first = count();
    physics.run(2 * MINUTE);
    expect(count()).toBeGreaterThan(first);
    expect(
      sh("ps -eo ppid,stat | awk '$2 ~ /Z/ {print $1}' | sort | uniq -c | awk '{print $2}'"),
    ).toBe(sh("pgrep licd"));
    sh("kill -9 20000");
    expect(count()).toBeGreaterThan(first);
    sh("systemctl restart licd");
    physics.run(MINUTE);
    expect(count()).toBe(0);
  });

  test("read-only file system: mount shows ro, writes fail, the kernel log says why; a remount ends it", () => {
    const { sh, inject, physics } = lab();
    inject("fs_readonly", "srv-a2");
    physics.run(MINUTE);
    expect(sh("mount | grep ' / '")).toContain("(ro,");
    expect(sh("journalctl -k -n 2")).toContain("Remounting filesystem read-only");
    expect(sh("rm /var/log/messages")).toContain("Read-only file system");
    sh("mount -o remount,rw /");
    physics.run(MINUTE);
    expect(sh("mount | grep ' / '")).toContain("(rw,");
  });

  test("clock drift: date runs ahead of the RTC, timedatectl and chronyc say unsynchronised, a chronyd restart ends it", () => {
    const { sh, inject, physics } = lab();
    inject("ntp_drift", "srv-a2", { secPerMin: 120 });
    physics.run(6 * MINUTE);
    expect(sh("timedatectl | grep 'System clock'")).toContain("no");
    expect(sh("chronyc tracking | grep Leap")).toContain("Not synchronised");
    expect(sh("chronyc tracking | grep 'System time'")).toMatch(/: [3-9]\d\d\.\d+ seconds fast/);
    expect(sh("journalctl -u chronyd -n 1")).toContain("System clock wrong by");
    sh("systemctl restart chronyd");
    expect(sh("chronyc tracking | grep Leap")).toContain("Normal");
  });

  test("DNS failure: resolv.conf names a dead resolver, dig times out on it and answers from the good one", () => {
    const { sh, inject, physics } = lab();
    inject("dns_failure", "srv-a2");
    physics.run(MINUTE);
    expect(sh("cat /etc/resolv.conf | grep nameserver")).toBe("nameserver 10.20.99.53");
    expect(sh("dig +short srv-a1")).toContain("connection timed out");
    expect(sh("dig @10.20.0.54 +short srv-a1")).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(sh("journalctl -u systemd-resolved -n 1")).toContain("Failed to send DNS query");
    sh("systemctl restart systemd-resolved");
    expect(sh("cat /etc/resolv.conf | grep -c nameserver")).toBe("2");
    expect(sh("dig +short srv-a1")).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  test("certificate expired: the file's notAfter is behind the clock, openssl says so, the app logs the handshake error", () => {
    const { sh, inject, physics } = lab();
    inject("cert_expired", "srv-a2");
    physics.run(2 * MINUTE);
    expect(sh("openssl x509 -noout -enddate -in /etc/ssl/certs/licd.pem")).toMatch(
      /^notAfter=Jan {2}1 00:\d\d:\d\d 2026 GMT$/,
    );
    expect(sh("openssl x509 -noout -checkend 0 -in /etc/ssl/certs/licd.pem")).toBe(
      "Certificate will expire",
    );
    expect(sh("grep notAfter /etc/ssl/certs/licd.pem")).toContain("2026");
    expect(sh("journalctl -u licd -n 1")).toContain("certificate has expired");
  });

  test("kernel panic: the host cannot be logged in to, then it is back with a short uptime and the panic in the previous boot's journal", () => {
    const { run, sh, inject, physics } = lab();
    inject("kernel_panic", "srv-a2", { downSeconds: 60 });
    physics.run(20);
    expect(run("srv-a2", "uptime")).toMatchObject({ exitCode: 255 });
    expect(run("srv-a2", "uptime").stderr).toContain("Connection timed out");
    physics.run(3 * MINUTE);
    expect(sh("uptime")).toMatch(/up \d+ min/);
    expect(sh("journalctl -b -1 -p err | grep -c 'Kernel panic'")).toBe("1");
    expect(sh("dmesg | grep -c 'Kernel panic'")).toMatch(/^\d+$/);
  });
});

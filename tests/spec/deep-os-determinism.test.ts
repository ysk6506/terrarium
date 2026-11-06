import type { FaultType } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const MINUTE = 60;

const SEQUENCE = [
  "ps aux",
  "top -b -n 1",
  "df -h",
  "du -sh /var/log /var/lib /etc",
  "free -m",
  "cat /proc/meminfo",
  "cat /proc/loadavg",
  "ls -lR /var/log",
  "journalctl -n 100",
  "journalctl -k",
  "dmesg",
  "cat /var/log/messages",
  "cat /var/log/licd/licd.log",
  "systemctl status licd",
  "systemctl list-units",
  "date",
  "timedatectl",
  "uptime",
  "ss -tlnp",
  "ip a",
  "dig +short srv-a1",
  "cat /etc/ssl/certs/licd.pem",
  "ls -l /etc/systemd/system",
  "stat /etc/hosts",
  "find /var -type f -size +1M",
  "echo hi > /tmp/x; cat /tmp/x; rm /tmp/x",
  "grep -r licd /etc | sort | head -5",
];

function transcript(fault?: FaultType): string[] {
  const { sh, inject, physics } = lab();
  if (fault) {
    inject(fault, "srv-a2", {});
    physics.run(7 * MINUTE);
  }
  return SEQUENCE.map((cmd) => sh(cmd));
}

describe("the same commands on a fresh world print the same text [REQ-098]", () => {
  test("on a healthy host", () => {
    expect(transcript()).toEqual(transcript());
  });

  for (const fault of [
    "disk_full",
    "log_flood",
    "memory_leak",
    "process_crashloop",
    "zombie_pileup",
    "fs_readonly",
    "ntp_drift",
    "dns_failure",
    "cert_expired",
  ] as const) {
    test(`with ${fault} on it`, () => {
      expect(transcript(fault)).toEqual(transcript(fault));
    });
  }
});

/**
 * Run a fault for 15 minutes with the world moved on in calls of `chunk` seconds each. A call to `run` is what the
 * session and the clock driver make, however long the stretch: the physics steps through it in its own small steps.
 */
function chunked(fault: FaultType, params: Record<string, number>, chunk: number) {
  const l = lab();
  l.inject(fault, "srv-a2", params);
  for (let left = 15 * MINUTE; left > 0; left -= chunk) l.physics.run(Math.min(chunk, left));
  return l;
}

describe("fast-forward leaves the same logs as stepping by the second [REQ-098]", () => {
  const cases: Array<[FaultType, Record<string, number>, string[]]> = [
    [
      "log_flood",
      { pctPerMin: 2 },
      ["journalctl -u licd -n 40", "cat /var/log/licd/licd.log | tail -n 30"],
    ],
    [
      "process_crashloop",
      { intervalS: 30 },
      [
        "journalctl -u licd -n 60",
        "systemctl show licd -p NRestarts",
        "systemctl status licd | tail -n 8",
      ],
    ],
    [
      "ntp_drift",
      { secPerMin: 90 },
      ["journalctl -u chronyd -n 20", "journalctl -u licd -p err -n 20"],
    ],
    [
      "dns_failure",
      {},
      [
        "journalctl -u systemd-resolved -n 20",
        "journalctl -u licd -p warning -n 20",
        "cat /etc/resolv.conf",
      ],
    ],
    [
      "cert_expired",
      {},
      ["journalctl -u licd -p err -n 20", "grep notAfter /etc/ssl/certs/licd.pem"],
    ],
  ];

  for (const [fault, params, commands] of cases) {
    test(`${fault}: steps of 1, 10, 60 and 300 seconds agree`, () => {
      const runs = [1, 10, 60, 300].map((chunk) => {
        const { sh } = chunked(fault, params, chunk);
        return commands.map((c) => sh(c));
      });
      for (const r of runs.slice(1)) expect(r).toEqual(runs[0]);
    });
  }

  test("the journal and /var/log/messages list the same lines in time order, and -n, --since and -b cut them consistently", () => {
    const { sh } = chunked("process_crashloop", { intervalS: 30 }, 60);
    const stamps = sh("journalctl -u systemd -n 200")
      .split("\n")
      .map((l) => l.slice(0, 15));
    expect([...stamps].sort()).toEqual(stamps);
    const all = sh("journalctl -u licd").split("\n");
    expect(sh("journalctl -u licd -n 5").split("\n")).toEqual(all.slice(-5));
    const recent = sh("journalctl -u licd --since '3 minutes ago'").split("\n");
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(all.length);
    expect(all.slice(-recent.length)).toEqual(recent);
    const messages = sh("grep 'Scheduled restart job' /var/log/messages")
      .split("\n")
      .map((l) => l.replace(/^\w+ +\d+ /, ""));
    const journal = sh("journalctl -u licd | grep 'Scheduled restart job'")
      .split("\n")
      .map((l) => l.replace(/^\w+ \d+ /, ""));
    expect(messages).toEqual(journal);
    expect(sh("journalctl -b -n 3")).not.toBe("-- No entries --");
  });

  test("the world's clock, not the run's, writes the stamps: the same fault at the same world time prints the same stamps", () => {
    const a = lab().sh("date");
    const b = lab().sh("date");
    expect(a).toBe(b);
    expect(a).toMatch(/^Thu Jan {2}1 00:10:00 UTC 2026$/);
  });
});

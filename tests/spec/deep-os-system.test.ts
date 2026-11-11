/**
 * The system and process commands of the deep operating-system fake (REQ-098, ADR-0117 decision 4): df, free, uptime,
 * date, hostname, uname, mount, logrotate, top, ps, pgrep, kill, each in the layout of the real tool and drawn from the
 * state of the host (a full disk, a read-only file system, a stopped service).
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("df, free, uptime and mount read the host's numbers [REQ-098]", () => {
  test("df has the three mounts in 1K blocks, -h in units, -T the type, -i the inodes, and a path picks its mount", () => {
    const { sh, run } = lab();
    expect(sh("df").split("\n")[0]).toBe(
      "Filesystem     1K-blocks      Used Available Use% Mounted on",
    );
    expect(sh("df -h")).toContain("/dev/sda2       200G  101G   99G  51% /");
    expect(sh("df -hT")).toContain("/dev/sda1      xfs      1014M  213M  801M  22% /boot");
    expect(sh("df -T").split("\n")[0]).toContain("Type");
    expect(sh("df -i")).toContain("/dev/sda2      13107200 1612800 11494400   13% /");
    expect(sh("df -h /boot")).toBe(
      "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1      1014M  213M  801M  22% /boot",
    );
    expect(sh("df -k /var/log")).toContain(
      "/dev/sda2       209715200  105696461  104018740  51% /",
    );
    expect(run("srv-a2", "df /nope")).toMatchObject({
      stderr: "df: /nope: No such file or directory",
      exitCode: 1,
    });
  });

  test("free shows memory in the unit asked for", () => {
    const { sh } = lab();
    expect(sh("free").split("\n")[0]).toBe(
      "               total        used        free      shared  buff/cache   available",
    );
    expect(sh("free -k").split("\n")[1]).toBe(
      "Mem: 1073741824  204010496  740882432    1231872  128848896  850404352",
    );
    expect(sh("free -g").split("\n")[1]).toBe(
      "Mem:       1024        195        707          1        123        811",
    );
    expect(sh("free -h").split("\n")[1]).toContain("1.0Ti");
  });

  test("uptime says how long the host has run, -p in words, -s since when", () => {
    const { sh, run } = lab();
    expect(sh("uptime")).toBe(
      " 00:10:00 up 14 days, 7:01,  1 user,  load average: 28.80, 27.36, 25.92",
    );
    expect(sh("uptime -p")).toBe("up 14 days, 7:01");
    expect(sh("uptime -s")).toBe("2025-12-17 17:08:10");
    expect(run("srv-a2", "uptime -x").outside).toEqual(["uptime -x"]);
  });

  test("mount lists the mounts, remounting read-write is allowed, anything else is outside the fake", () => {
    const { sh, run } = lab();
    expect(sh("mount").split("\n")[0]).toBe(
      "/dev/sda2 on / type ext4 (rw,relatime,seclabel,errors=remount-ro)",
    );
    expect(run("srv-a2", "mount -o remount,rw /").exitCode).toBe(0);
    expect(run("srv-a2", "mount -o ro /x").outside).toEqual(["mount -o ro /x"]);
    expect(sh("lsblk").split("\n")[2]).toBe("├─sda1   8:1    0     1G  0 part /boot");
  });

  test("a read-only root shows in mount and stops logrotate, and remounting brings writes back", () => {
    const { sh, run, inject, physics } = lab();
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    expect(sh("mount").split("\n")[0]).toContain("(ro,relatime");
    expect(run("srv-a2", "logrotate -f /etc/logrotate.conf")).toMatchObject({
      stderr: "error: error creating output file /var/log/messages-20261105: Read-only file system",
      exitCode: 1,
    });
    expect(run("srv-a2", "rm /var/log/messages").stderr).toContain("Read-only file system");
  });

  test("logrotate needs a config that exists, -d only reads it, -f rotates", () => {
    const { run } = lab();
    expect(run("srv-a2", "logrotate")).toMatchObject({ exitCode: 1 });
    expect(run("srv-a2", "logrotate /nope").stderr).toBe(
      "error: stat of /nope failed: No such file or directory",
    );
    expect(run("srv-a2", "logrotate -d /etc/logrotate.conf").stdout).toBe(
      "reading config file /etc/logrotate.conf",
    );
    expect(run("srv-a2", "logrotate -f /etc/logrotate.conf")).toMatchObject({
      stdout: "",
      exitCode: 0,
    });
    expect(run("srv-a2", "logrotate -z").outside).toEqual(["logrotate -z"]);
  });
});

describe("date, hostname, uname and who say what the host is [REQ-098]", () => {
  test("date prints the host's clock in the formats asked for, and understands relative words", () => {
    const { sh, run } = lab();
    expect(sh("date")).toBe("Thu Jan  1 00:10:00 UTC 2026");
    expect(sh("date +%Y-%m-%d")).toBe("2026-01-01");
    expect(sh("date -R")).toBe("Thu, 01 Jan 2026 00:10:00 +0000");
    expect(sh("date -I")).toBe("2026-01-01");
    expect(sh("date +%s")).toBe("1767226200");
    expect(sh("date '+%a %b %e %H:%M:%S %Z %Y'")).toBe("Thu Jan  1 00:10:00 UTC 2026");
    expect(sh("date '+%A %B %d %y %I %p'")).toBe("Thursday January 01 26 12 AM");
    expect(sh("date -d '2 hours ago' +%H:%M")).toBe("22:10");
    expect(sh("date -d tomorrow +%F")).toBe("2026-01-02");
    expect(sh("date --date='1 day ago' +%F")).toBe("2025-12-31");
    expect(run("srv-a2", "date -d nonsense")).toMatchObject({
      stderr: "date: invalid date 'nonsense'",
      exitCode: 1,
    });
  });

  test("hostname has its long, short, domain and address forms; uname its kernel ones; whoami and id the login", () => {
    const { sh } = lab();
    expect(sh("hostname")).toBe("srv-a2");
    expect(sh("hostname -f")).toBe("srv-a2.dc.local");
    expect(sh("hostname -i")).toBe("10.0.0.11");
    expect(sh("hostname -d")).toBe("dc.local");
    expect(sh("uname")).toBe("Linux");
    expect(sh("uname -r")).toBe("5.14.0-427.el9.x86_64");
    expect(sh("uname -n")).toBe("srv-a2");
    expect(sh("uname -m")).toBe("x86_64");
    expect(sh("whoami")).toBe("ops");
    expect(sh("id")).toBe("uid=1000(ops) gid=1000(ops) groups=1000(ops),10(wheel)");
  });

  test("a reboot closes the connection, and the host answers again once it is up", () => {
    const { sh, run, physics } = lab();
    expect(run("srv-a2", "reboot")).toMatchObject({
      stderr: "Connection to srv-a2 closed by remote host.",
      exitCode: 0,
    });
    expect(run("srv-a2", "hostname").stderr).toContain("Connection timed out");
    physics.run(300);
    expect(sh("hostname")).toBe("srv-a2");
  });
});

describe("top and ps list the processes of the host [REQ-098]", () => {
  test("top -bn1 prints the summary and the busiest processes first", () => {
    const { sh, run } = lab();
    const out = sh("top -bn1").split("\n");
    expect(out[0]).toBe(
      "top - 00:10:00 up 14 days, 7:01,  1 user,  load average: 28.80, 27.36, 25.92",
    );
    expect(out[1]).toBe("Tasks:  16 total,   0 running,  16 sleeping,   0 stopped,   0 zombie");
    expect(out[7]).toContain(" licd");
    expect(sh("top -bn1 -p 645").split("\n")).toHaveLength(8);
    expect(run("srv-a2", "top -bn1 -u appsvc").outside).toEqual(["top -u"]);
    expect(run("srv-a2", "top -H")).toMatchObject({ stderr: "top: failed tty get", exitCode: 1 });
  });

  test("ps aux, ps -ef and -eo give the layouts of the real ones, sorted and cut as asked", () => {
    const { sh } = lab();
    expect(sh("ps aux").split("\n")[0]).toBe(
      "USER              PID %CPU %MEM       VSZ      RSS TT    STAT START    TIME COMMAND",
    );
    expect(sh("ps -ef").split("\n")[0]).toBe(
      "UID          PID    PPID  C STIME TTY          TIME CMD",
    );
    expect(sh("ps -eo pid,comm").split("\n").slice(0, 2)).toEqual([
      "  PID COMMAND",
      "    1 systemd",
    ]);
    expect(sh("ps -eo pid,ppid,user,%cpu,%mem,comm --sort=-%cpu").split("\n")[1]).toBe(
      "  645     1 appsvc          21.8  9.0 licd",
    );
    expect(sh("ps aux --sort=-rss").split("\n")[1]).toContain(
      "/opt/app/bin/licd --config /etc/licd.conf",
    );
    expect(sh("ps --no-headers -eo pid").split("\n").slice(0, 2)).toEqual(["1", "2"]);
    expect(sh("ps -o rss= -p 645")).toBe("96636764");
    expect(sh("ps -p 645 -o pid,comm,etime")).toBe("PID COMMAND ELAPSED\n645 licd    14-07:01:33");
    expect(sh("ps -C licd")).toBe("PID TT    TIME COMMAND\n645 ?  4486:46 licd");
    expect(sh("ps -u appsvc")).toContain("appsvc 645 21.8  9.0");
    expect(sh("ps -ef | grep licd")).toContain("/opt/app/bin/licd --config /etc/licd.conf");
    expect(sh("ps -p 99999")).toBe("PID TT TIME COMMAND");
    expect(sh("ps ax").split("\n")).toHaveLength(17);
  });

  test("pgrep and pidof find processes by name, -l -a -f -c change what is printed, none found means exit 1", () => {
    const { sh, run } = lab();
    expect(sh("pgrep licd")).toBe("645");
    expect(sh("pgrep -l licd")).toBe("645 licd");
    expect(sh("pgrep -a licd")).toBe("645 /opt/app/bin/licd --config /etc/licd.conf");
    expect(sh("pgrep -f licd")).toBe("645");
    expect(sh("pgrep -c licd")).toBe("1");
    expect(sh("pidof licd")).toBe("645");
    expect(run("srv-a2", "pgrep nope")).toMatchObject({ stdout: "", exitCode: 1 });
    expect(run("srv-a2", "pidof nope")).toMatchObject({ stdout: "", exitCode: 1 });
  });

  test("kill sends a signal to a process that is there, names one that is not, and lists the signals", () => {
    const { sh, run, world } = lab();
    expect(sh("kill -l").split("\n")[0]).toBe("1) SIGHUP");
    expect(run("srv-a2", "kill 99999")).toMatchObject({
      stderr: "bash: kill: (99999) - No such process",
      exitCode: 1,
    });
    expect(run("srv-a2", "kill -0 645").exitCode).toBe(0);
    expect(run("srv-a2", "pkill -0 licd").exitCode).toBe(0);
    expect(run("srv-a2", "kill -HUP 645").exitCode).toBe(0);
    expect(run("srv-a2", "kill -s HUP 645").exitCode).toBe(0);
    expect(run("srv-a2", "kill -TERM 645").exitCode).toBe(0);
    expect(run("srv-a2", "kill 645").stderr).toBe("bash: kill: (645) - No such process");
    expect(world.events().some((e) => e.type === "host.act")).toBe(true);
    expect(sh("nice")).toBe("0");
    expect(sh("nice -n 5 echo hi")).toBe("hi");
    expect(run("srv-a2", "renice").outside).toEqual(["renice"]);
  });
});

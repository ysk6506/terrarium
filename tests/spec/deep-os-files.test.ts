/**
 * The file commands of the deep operating-system fake (REQ-098, ADR-0117 decision 4): ls, du, stat, touch, cp, mv, rm,
 * truncate, env and the proc and var files, each doing what the real command does on the fake host, and refusing in the
 * real command's words what it cannot do.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("du reports sizes the way the real command does [REQ-098]", () => {
  test("-s sums a directory, -b counts bytes, -m megabytes, -h picks a unit, -c adds a total", () => {
    const { sh } = lab();
    expect(sh("du -s /etc")).toBe("28\t/etc");
    expect(sh("du -sb /etc/hostname")).toBe("7\t/etc/hostname");
    expect(sh("du -sm /var")).toBe("95587\t/var");
    expect(sh("du -sh /etc /var")).toBe("28K\t/etc\n94G\t/var");
    expect(sh("du -c /etc/passwd /etc/group")).toBe("4\t/etc/passwd\n4\t/etc/group\n4\ttotal");
    expect(sh("du --human-readable --summarize /var")).toBe("94G\t/var");
  });

  test("a depth limit lists the first level only, -a also lists files, no argument means the working directory", () => {
    const { sh } = lab();
    expect(sh("du -d 1 /etc")).toBe(
      "8\t/etc/logrotate.d\n12\t/etc/ssl\n12\t/etc/systemd\n28\t/etc",
    );
    expect(sh("du --max-depth=1 /var")).toBe(
      "97576824\t/var/lib\n304008\t/var/log\n97880832\t/var",
    );
    expect(sh("du -a /etc/systemd").split("\n")).toHaveLength(10);
    expect(sh("du")).toBe("8\t./.ssh\n12\t.");
    expect(sh("cd /etc; du -s")).toBe("28\t.");
  });

  test("a path that is not there is named, and the exit code says so", () => {
    const { run } = lab();
    expect(run("srv-a2", "du /nope")).toMatchObject({
      stderr: "du: cannot access '/nope': No such file or directory",
      exitCode: 1,
    });
  });
});

describe("ls lists, sorts and refuses like the real command [REQ-098]", () => {
  test("a plain listing is sorted by name; -r reverses it, -d names the directory itself", () => {
    const { sh } = lab();
    expect(sh("ls /etc").split("\n").slice(0, 3)).toEqual(["chrony.conf", "fstab", "group"]);
    expect(sh("ls -r /etc").split("\n").slice(0, 2)).toEqual(["systemd", "ssl"]);
    expect(sh("ls -d /etc /var")).toBe("/etc\n/var");
    expect(sh("ls -a /home")).toBe("ops");
  });

  test("-l shows mode, owner, size and date; -h writes the size in units; -R descends", () => {
    const { sh } = lab();
    expect(sh("ls -l /etc/hostname")).toBe(
      "-rw-r--r-- 1 root     root              7 Dec 17 17:08 /etc/hostname",
    );
    expect(sh("ls -ld /etc")).toContain("drwxr-xr-x 2 root     root           4096");
    expect(sh("ls -lh /var/log").split("\n")[2]).toContain("16M");
    expect(sh("ls -lA /home/ops")).toContain(".bashrc");
    expect(sh("ls -R /etc/systemd")).toContain("/etc/systemd/system:\nchronyd.service");
  });

  test("-S sorts by size, -t by time, and several arguments are headed by their names", () => {
    const { sh } = lab();
    expect(sh("ls -S /etc").split("\n").slice(0, 3)).toEqual(["logrotate.d", "ssl", "systemd"]);
    expect(sh("ls -lt /var/log").split("\n")[1]).toContain("auth.log");
    expect(sh("ls -lrt /var/log").split("\n")[1]).toContain("licd");
    expect(sh("ls /etc/hostname /var")).toBe("/etc/hostname\n/var:\nlib\nlog");
  });

  test("a missing path is named with exit 2, and an option the fake does not have is counted as outside the fake", () => {
    const { run } = lab();
    expect(run("srv-a2", "ls /nope")).toMatchObject({
      stderr: "ls: cannot access '/nope': No such file or directory",
      exitCode: 2,
    });
    for (const flag of ["-s", "-m", "-n", "--color=auto", "--si"]) {
      const r = run("srv-a2", `ls ${flag} /etc/hostname`);
      expect(r.exitCode).toBe(2);
      expect(r.outside).toEqual([`ls ${flag}`]);
    }
  });
});

describe("stat, touch, cp, mv, rm and truncate change and refuse like the real ones [REQ-098]", () => {
  test("stat prints the block a real one does, -c picks fields, a missing file is named", () => {
    const { sh, run } = lab();
    expect(sh("stat /etc/hostname").split("\n").slice(0, 3)).toEqual([
      "  File: /etc/hostname",
      "  Size: 7         Blocks: 8          IO Block: 4096   regular file",
      "Device: 802h/2050d\tInode: 131074      Links: 1",
    ]);
    expect(sh("stat -c %s /etc/hostname")).toBe("7");
    expect(sh("stat -c '%n %s %a' /etc/hostname")).toBe("/etc/hostname 7 644");
    expect(sh("stat /etc")).toContain("directory");
    expect(run("srv-a2", "stat /nope").stderr).toBe(
      "stat: cannot statx '/nope': No such file or directory",
    );
    expect(run("srv-a2", "stat -f /").outside).toEqual(["stat -f"]);
  });

  test("touch creates an empty file once, and cannot create one where there is no directory", () => {
    const { sh, run } = lab();
    sh("touch /tmp/_t1 /tmp/_t2");
    expect(sh("ls /tmp")).toContain("_t1\n_t2");
    expect(sh("ls -l /tmp/_t1")).toContain(" 0 ");
    expect(run("srv-a2", "touch /nope/x")).toMatchObject({
      stderr: "touch: cannot create regular file '/nope/x': Permission denied",
      exitCode: 1,
    });
    expect(run("srv-a2", "touch").stderr).toBe("touch: missing file operand");
  });

  test("cp copies a file, into a directory under its own name, and mv moves it", () => {
    const { sh, run } = lab();
    sh("cp /etc/hostname /tmp/_c1");
    expect(sh("cat /tmp/_c1")).toBe("srv-a2");
    sh("cp /etc/hostname /tmp/");
    expect(sh("cat /tmp/hostname")).toBe("srv-a2");
    sh("touch /tmp/_m1");
    sh("mv /tmp/_m1 /tmp/_m2");
    expect(sh("ls /tmp")).toContain("_m2");
    expect(sh("ls /tmp")).not.toContain("_m1");
    expect(run("srv-a2", "cp /nope /tmp/x").stderr).toBe(
      "cp: cannot stat '/nope': No such file or directory",
    );
    expect(run("srv-a2", "mv /nope /tmp/x").stderr).toBe(
      "mv: cannot stat '/nope': No such file or directory",
    );
    expect(run("srv-a2", "cp /etc/hostname /nope/x").stderr).toBe(
      "cp: cannot create regular file '/nope/x': Permission denied",
    );
    expect(run("srv-a2", "cp /etc/hostname").outside).toEqual(["cp 인자 두 개만 돼요"]);
  });

  test("rm removes files, -v says so, -f keeps quiet about what is missing, a directory and a system file are refused", () => {
    const { sh, run } = lab();
    sh("touch /tmp/_v1 /tmp/_v2");
    expect(sh("rm -v /tmp/_v1 /tmp/_v2")).toBe("removed '/tmp/_v1'\nremoved '/tmp/_v2'");
    expect(run("srv-a2", "rm /nope")).toMatchObject({
      stderr: "rm: cannot remove '/nope': No such file or directory",
      exitCode: 1,
    });
    expect(run("srv-a2", "rm -f /nope").exitCode).toBe(0);
    expect(run("srv-a2", "rm --recursive --force /nope").exitCode).toBe(0);
    expect(run("srv-a2", "rm /tmp").stderr).toBe("rm: cannot remove '/tmp': Is a directory");
    expect(run("srv-a2", "rm /etc/hostname").stderr).toBe(
      "rm: cannot remove '/etc/hostname': Operation not permitted",
    );
    expect(run("srv-a2", "rm").stderr).toBe("rm: missing operand");
  });

  test("truncate to zero empties a file; another size, or none, is refused", () => {
    const { sh, run } = lab();
    sh("echo hello > /tmp/_tr");
    expect(sh("ls -l /tmp/_tr")).toContain(" 6 ");
    sh("truncate -s 0 /tmp/_tr");
    expect(sh("ls -l /tmp/_tr")).toContain(" 0 ");
    expect(run("srv-a2", "truncate /tmp/_tr")).toMatchObject({
      stderr: "truncate: you must specify either '--size' or '--reference'",
      exitCode: 1,
    });
    expect(run("srv-a2", "truncate -s 100 /tmp/_tr").outside).toEqual([
      "truncate -s 100 (0만 돼요)",
    ]);
    expect(run("srv-a2", "truncate -s 0 /tmp/_missing")).toMatchObject({
      stderr: "truncate: cannot open '/tmp/_missing' for writing: No such file or directory",
      exitCode: 1,
    });
  });

  test("env prints the login environment, printenv one value of it", () => {
    const { sh } = lab();
    expect(sh("env").split("\n")).toContain("HOSTNAME=srv-a2");
    expect(sh("printenv HOME")).toBe("/home/ops");
    expect(sh("cd /tmp; env")).toContain("PWD=/tmp");
  });
});

describe("the proc and etc files tell what the host is [REQ-098]", () => {
  test("/proc answers with the host's CPU, memory, load, mounts and command line", () => {
    const { sh } = lab();
    expect(sh("cat /proc/cpuinfo | head -3")).toContain("model name\t: Intel(R) Xeon(R) Gold 6430");
    expect(sh("cat /proc/meminfo | head -1")).toBe("MemTotal:         1073741824 kB");
    expect(sh("cat /proc/loadavg")).toMatch(/^\d+\.\d\d \d+\.\d\d \d+\.\d\d \d+\/\d+ \d+$/);
    expect(sh("cat /proc/uptime")).toMatch(/^\d+\.00 \d+\.00$/);
    expect(sh("cat /proc/version")).toContain("Linux version 5.14.0-427.el9.x86_64");
    expect(sh("cat /proc/mounts | head -1")).toBe(
      "/dev/sda2 / ext4 rw,relatime,errors=remount-ro 0 0",
    );
    expect(sh("cat /proc/cmdline")).toContain("root=/dev/sda2 ro");
    expect(sh("cat /proc/1/status | head -2")).toBe("Name:\tsystemd\nState:\tS (sleeping)");
    expect(sh("ls /proc/1")).toBe("cmdline\ncomm\nstat\nstatus");
  });

  test("/etc has the OS release, the mounts table, the resolver and the hosts the host knows", () => {
    const { sh } = lab();
    expect(sh("cat /etc/os-release")).toContain(
      'PRETTY_NAME="Red Hat Enterprise Linux 9.4 (Plow)"',
    );
    expect(sh("cat /etc/fstab | head -1")).toContain("/dev/sda2  /          ext4");
    expect(sh("cat /etc/resolv.conf")).toContain("nameserver 10.20.0.53");
    expect(sh("cat /etc/hosts")).toContain("10.0.0.11 srv-a2 srv-a2.dc.local");
    expect(sh("cat /etc/chrony.conf")).toContain("server 10.20.0.2 iburst");
    expect(sh("cat /etc/logrotate.d/*")).toContain("/var/log/licd/*.log {");
    expect(sh("cat /etc/ssl/certs/*")).toContain("# subject=CN=licd.dc.local");
    expect(sh("ls /dev")).toContain("sda1");
  });
});

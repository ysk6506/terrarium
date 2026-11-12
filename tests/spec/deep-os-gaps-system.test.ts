/**
 * Units, time, certificates, processes and files of the deep operating-system fake (REQ-098, ADR-0117 decision 4) in the
 * cases the larger specs leave out: how long ago a unit started, a disabled or unknown unit, a clock that has drifted, a
 * certificate with no date, the columns of `ps` and `top`, and files that refuse a write. Expected text is what the real
 * tool prints.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("systemctl [REQ-098]", () => {
  test("[REQ-098] how long ago a unit started is told in seconds, minutes, hours and days as time passes", () => {
    const { sh, physics } = lab();
    sh("systemctl restart chronyd");
    physics.run(5);
    expect(sh("systemctl status chronyd | grep Active")).toContain("; 5s ago");
    physics.run(120);
    expect(sh("systemctl status chronyd | grep Active")).toContain("; 2min 5s ago");
    physics.run(4000);
    expect(sh("systemctl status chronyd | grep Active")).toContain("; 1h 8min ago");
    physics.run(200_000);
    expect(sh("systemctl status chronyd | grep Active")).toContain("; 2 days ago");
  });

  test("[REQ-098] a disabled unit says so in its status and in is-enabled, and enable brings it back", () => {
    const { run, sh } = lab();
    expect(sh("systemctl disable chronyd")).toBe(
      'Removed "/etc/systemd/system/multi-user.target.wants/chronyd.service".',
    );
    expect(sh("systemctl status chronyd | grep Loaded")).toContain("; disabled;");
    expect(run("srv-a2", "systemctl is-enabled chronyd")).toMatchObject({
      exitCode: 1,
      stdout: "disabled",
    });
    expect(sh("systemctl enable chronyd")).toContain("Created symlink");
    expect(sh("systemctl status chronyd | grep Loaded")).toContain("; enabled;");
    expect(run("srv-a2", "systemctl is-enabled chronyd")).toMatchObject({
      exitCode: 0,
      stdout: "enabled",
    });
  });

  test("[REQ-098] a unit that does not exist cannot be enabled or shown, and asking with no name finds none", () => {
    const { run } = lab();
    expect(run("srv-a2", "systemctl enable nosuch")).toMatchObject({
      exitCode: 1,
      stderr: "Failed to enable unit: Unit file nosuch.service does not exist.",
    });
    expect(run("srv-a2", "systemctl show nosuch")).toMatchObject({
      exitCode: 1,
      stderr: "Unit nosuch.service could not be found.",
    });
    expect(run("srv-a2", "systemctl show")).toMatchObject({ exitCode: 1 });
    expect(run("srv-a2", "systemctl is-active")).toMatchObject({ exitCode: 3, stdout: "inactive" });
    expect(run("srv-a2", "systemctl is-enabled")).toMatchObject({
      exitCode: 1,
      stdout: "disabled",
    });
    expect(run("srv-a2", "systemctl is-failed")).toMatchObject({ exitCode: 1, stdout: "inactive" });
    expect(run("srv-a2", "systemctl cat")).toMatchObject({ exitCode: 1 });
    expect(run("srv-a2", "systemctl list-units --failed").stdout).toContain(
      "0 loaded units listed.",
    );
  });

  test("[REQ-098] on a read-only file system a unit can be neither enabled nor disabled", () => {
    const { run, inject, physics } = lab();
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    expect(run("srv-a2", "systemctl enable chronyd")).toMatchObject({
      exitCode: 1,
      stderr: "Failed to enable unit: Read-only file system",
    });
    expect(run("srv-a2", "systemctl disable chronyd")).toMatchObject({
      exitCode: 1,
      stderr: "Failed to disable unit: Read-only file system",
    });
  });
});

describe("time and certificates [REQ-098]", () => {
  test("[REQ-098] a drifted clock is unsynchronised in timedatectl, and chronyc sources shows the offset in milliseconds", () => {
    const { sh, inject, physics } = lab();
    expect(sh("timedatectl show")).toContain("NTPSynchronized=yes");
    inject("ntp_drift", "srv-a2", { secPerMin: 120 });
    physics.run(300);
    expect(sh("timedatectl show")).toContain("NTPSynchronized=no");
    const source = sh("chronyc sources").split("\n")[2] as string;
    expect(source).toMatch(/^\^\? 10\.20\.0\.2 +0 +6 +377 +9m +600002ms\[600002ms\] \+\/- +12ms$/);
  });

  test("[REQ-098] openssl and chronyc without a subcommand are refused and counted outside, as are unknown switches", () => {
    const { run } = lab();
    expect(run("srv-a2", "openssl")).toMatchObject({
      exitCode: 2,
      outside: ["openssl 대화형 모드"],
    });
    expect(run("srv-a2", "openssl x509 -foo")).toMatchObject({ exitCode: 1, outside: [] });
    expect(run("srv-a2", "chronyc")).toMatchObject({
      exitCode: 2,
      outside: ["chronyc 대화형 모드"],
    });
  });

  test("[REQ-098] openssl x509 needs a file, says when it cannot open one, and prints an empty field for a line the file lacks", () => {
    const { run, sh } = lab();
    expect(run("srv-a2", "openssl x509 -in")).toMatchObject({
      exitCode: 1,
      stderr: "openssl x509: no input file (-in)",
    });
    expect(run("srv-a2", "openssl x509 -in /tmp/none")).toMatchObject({
      exitCode: 1,
      stderr: "Could not open file or uri for loading certificate from /tmp/none",
    });
    sh("printf '# subject=CN=x\\n# notAfter=Jan  1 00:00:00 2020 GMT\\n' > /tmp/c.pem");
    expect(sh("openssl x509 -in /tmp/c.pem -noout -subject -issuer -enddate -startdate")).toBe(
      "notBefore=\nnotAfter=Jan  1 00:00:00 2020 GMT\nsubject=CN=x\nissuer=",
    );
  });

  test("[REQ-098] -checkend: a date in the past or one that cannot be read has expired, a date far ahead has not", () => {
    const { run, sh } = lab();
    sh("printf '# notAfter=Jan  1 00:00:00 2020 GMT\\n' > /tmp/old.pem");
    sh("printf '# notAfter=Foo  1 00:00:00 2090 GMT\\n' > /tmp/odd.pem");
    sh("printf '# notAfter=Jan  1 00:00:00 2090 GMT\\n' > /tmp/new.pem");
    expect(run("srv-a2", "openssl x509 -in /tmp/old.pem -checkend 0")).toMatchObject({
      exitCode: 1,
      stdout: "Certificate will expire",
    });
    expect(run("srv-a2", "openssl x509 -in /tmp/odd.pem -checkend 0")).toMatchObject({
      exitCode: 1,
      stdout: "Certificate will expire",
    });
    expect(run("srv-a2", "openssl x509 -in /tmp/new.pem -checkend 100")).toMatchObject({
      exitCode: 0,
      stdout: "Certificate will not expire",
    });
  });
});

describe("ps and top [REQ-098]", () => {
  test("[REQ-098] a sort key the fake does not know is refused and counted outside", () => {
    const { run } = lab();
    // ADR-0184: a sort key no ps has is refused by ps itself (no hint, nothing outside); a top field no top has likewise
    expect(run("srv-a2", "ps --sort=nosuch")).toMatchObject({ exitCode: 1, outside: [] });
    expect(run("srv-a2", "top -b -n 1 -o nosuch")).toMatchObject({ exitCode: 1, outside: [] });
    expect(run("srv-a2", "top").stderr).toBe("top: failed tty get");
  });

  test("[REQ-098] top -o sorts by the column named, ps -ef drops its header with -h or --no-headers", () => {
    const { sh } = lab();
    expect(sh("top -b -n 1 -o %MEM")).toContain("PID USER");
    expect(sh("top -b -n 1 -o +%MEM")).toContain("PID USER");
    expect(sh("ps -ef")).toContain("UID          PID    PPID  C STIME TTY          TIME CMD");
    expect(sh("ps -efh")).not.toContain("UID ");
    expect(sh("ps -ef --no-headers")).not.toContain("UID ");
    expect(sh("ps -ef --no-headers")).toBe(sh("ps -efh"));
  });
});

describe("files [REQ-098]", () => {
  test("[REQ-098] ls with no path lists the working directory, -F marks directories, -R starts at /", () => {
    const { sh } = lab();
    expect(sh("cd /etc && ls")).toContain("hosts");
    expect(sh("ls -F /")).toContain("tmp/");
    expect(sh("ls -R / | head -1")).toBe("/:");
    expect(sh("ls -R / | grep -c 'tmp:$'")).toBe("1");
  });

  test("[REQ-098] stat -c leaves a format letter it does not know as it is, and names a file owner other than root", () => {
    const { sh } = lab();
    expect(sh("stat -c '%Q %n' /etc/hosts")).toBe("%Q /etc/hosts");
    expect(sh("stat /tmp/licd-upload.tmp | grep Uid")).toBe(
      "Access: (0644/-rw-r--r--)  Uid: ( 1000/  appsvc)   Gid: ( 1000/  appsvc)",
    );
    expect(sh("stat /var/log/syslog | grep Uid")).toContain("Uid: (    0/    root)");
  });

  test("[REQ-098] du of a plain file is its size, rm -rf / is refused, touch leaves an existing file as it is", () => {
    const { run, sh } = lab();
    expect(sh("du /etc/hosts")).toBe("4\t/etc/hosts");
    expect(run("srv-a2", "rm -rf /")).toMatchObject({
      exitCode: 1,
      stderr: "rm: it is dangerous to operate recursively on '/'",
    });
    sh("echo keep > /tmp/t1");
    sh("touch /tmp/t1 /tmp/t2");
    expect(sh("cat /tmp/t1")).toBe("keep");
    expect(sh("cat /tmp/t2 | wc -c")).toBe("0");
  });

  test("[REQ-098] truncate is refused where a write is, in the words of the reason", () => {
    const { run, inject, physics } = lab();
    expect(run("srv-a2", "truncate -s 0 /newfile")).toMatchObject({
      exitCode: 1,
      stderr: "truncate: cannot open '/newfile' for writing: Permission denied",
    });
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    expect(run("srv-a2", "truncate -s 0 /etc/hosts")).toMatchObject({
      exitCode: 1,
      stderr: "truncate: cannot open '/etc/hosts' for writing: Read-only file system",
    });
  });
});

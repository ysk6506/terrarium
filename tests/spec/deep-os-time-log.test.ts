/**
 * The time, certificate and log commands of the deep operating-system fake (REQ-098, ADR-0117 decision 4): chronyc,
 * timedatectl, openssl x509, journalctl and dmesg print what the real tools print for a host in good order and refuse
 * in their own words what the fake does not do.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("chronyc and timedatectl tell whether the clock is in step [REQ-098]", () => {
  test("tracking and sources show the reference, the offset and the reach of a synchronised host", () => {
    const { sh } = lab();
    const tracking = sh("chronyc tracking").split("\n");
    expect(tracking[0]).toBe("Reference ID    : 0A140002 (ntp1.dc.local)");
    expect(tracking[1]).toBe("Stratum         : 3");
    expect(tracking[3]).toBe("System time     : 0.002000000 seconds fast of NTP time");
    expect(tracking[7]).toBe("Leap status     : Normal");
    expect(sh("chronyc sources").split("\n")[2]).toBe(
      "^* 10.20.0.2                   2   6   377    38  2000us[2000us] +/-   12ms",
    );
    expect(sh("chronyc sources -v")).toBe(sh("chronyc sources"));
    expect(sh("chronyc sourcestats")).toBe(sh("chronyc sources"));
  });

  test("a command chronyc has and the fake does not is outside it, as is the interactive prompt", () => {
    const { run } = lab();
    // ADR-0184: makestep and activity are chronyc's own; `foo` is no command, and chronyc answers 501 itself
    for (const verb of ["makestep", "activity"])
      expect(run("srv-a2", `chronyc ${verb}`)).toMatchObject({
        exitCode: 2,
        outside: [`chronyc ${verb}`],
      });
    expect(run("srv-a2", "chronyc foo")).toMatchObject({ exitCode: 1, outside: [] });
    expect(run("srv-a2", "chronyc").outside).toEqual(["chronyc 대화형 모드"]);
  });

  test("timedatectl shows the local and universal time and says the clock is synchronised", () => {
    const { sh, run } = lab();
    const status = sh("timedatectl").split("\n");
    expect(status[0]).toBe("               Local time: Thu 2026-01-01 00:10:00 UTC");
    expect(status[4]).toBe("System clock synchronized: yes");
    expect(status[5]).toBe("              NTP service: active");
    expect(sh("timedatectl status")).toBe(sh("timedatectl"));
    expect(sh("timedatectl show")).toBe("Timezone=UTC\nLocalRTC=no\nNTPSynchronized=yes\nNTP=yes");
    // ADR-0184: set-ntp and timesync-status are timedatectl's own; `foo` is no verb and timedatectl says so itself
    for (const verb of ["set-ntp true", "timesync-status"])
      expect(run("srv-a2", `timedatectl ${verb}`).outside).toEqual([
        `timedatectl ${verb.split(" ")[0]}`,
      ]);
    expect(run("srv-a2", "timedatectl foo").outside).toEqual([]);
  });
});

describe("openssl x509 reads the certificate files of the host [REQ-098]", () => {
  test("-enddate, -dates, -subject and -issuer print the fields of the certificate, in the order asked", () => {
    const { sh } = lab();
    const pem = "-in /etc/ssl/certs/licd.pem -noout";
    expect(sh(`openssl x509 ${pem} -enddate`)).toBe("notAfter=Dec  2 00:00:00 2027 GMT");
    expect(sh(`openssl x509 ${pem} -dates`)).toBe(
      "notBefore=Mar  7 00:00:00 2025 GMT\nnotAfter=Dec  2 00:00:00 2027 GMT",
    );
    expect(sh(`openssl x509 ${pem} -subject`)).toBe("subject=CN=licd.dc.local");
    expect(sh(`openssl x509 ${pem} -issuer`)).toBe("issuer=CN=Terrarium Internal CA");
    expect(sh(`openssl x509 ${pem} -subject -enddate`)).toContain("subject=CN=licd.dc.local");
    expect(sh(`openssl x509 ${pem} -checkend 86400`)).toBe("Certificate will not expire");
  });

  test("a missing file or input and the parts of openssl the fake does not have are refused", () => {
    const { run } = lab();
    expect(run("srv-a2", "openssl x509 -in /nope -noout -enddate")).toMatchObject({
      stderr: "Could not open file or uri for loading certificate from /nope",
      exitCode: 1,
    });
    expect(run("srv-a2", "openssl x509 -noout -enddate")).toMatchObject({
      stderr: "openssl x509: no input file (-in)",
      exitCode: 1,
    });
    expect(run("srv-a2", "openssl x509 -in /etc/ssl/certs/licd.pem -noout -text").outside).toEqual([
      "openssl x509 -text",
    ]);
    for (const verb of ["s_client -connect licd:8701", "version"])
      expect(run("srv-a2", `openssl ${verb}`).outside).toEqual([`openssl ${verb.split(" ")[0]}`]);
  });
});

describe("journalctl and dmesg read the logs of the host [REQ-098]", () => {
  test("-n takes the last lines, -u one unit, -r reverses, a name nobody logs under has no entries", () => {
    const { sh } = lab();
    expect(sh("journalctl -n 3").split("\n")).toEqual([
      "Jan 01 00:06:28 srv-a2 licd[645]: INFO GET /healthz 200 3ms",
      "Jan 01 00:07:42 srv-a2 CRON[4862]: (root) CMD (/usr/lib/sa/sa1 1 1)",
      "Jan 01 00:08:28 srv-a2 licd[645]: INFO GET /healthz 200 9ms",
    ]);
    expect(sh("journalctl -u licd -n 2")).toBe(
      "Jan 01 00:06:28 srv-a2 licd[645]: INFO GET /healthz 200 3ms\nJan 01 00:08:28 srv-a2 licd[645]: INFO GET /healthz 200 9ms",
    );
    expect(sh("journalctl -r -n 2").split("\n")[0]).toContain("00:08:28");
    expect(sh("journalctl -u nope")).toBe("-- No entries --");
    expect(sh("journalctl -p err -n 3")).toBe("-- No entries --");
    expect(sh("journalctl -k -n 2")).toBe("-- No entries --");
  });

  test("--since and --until cut by time, in words or as a date; -g filters by text; --list-boots and --disk-usage answer", () => {
    const { sh } = lab();
    expect(sh("journalctl --since '2026-01-01 00:00' --until '2026-01-01 00:05' -n 2")).toBe(
      "Jan 01 00:02:28 srv-a2 licd[645]: INFO GET /healthz 200 10ms\nJan 01 00:04:28 srv-a2 licd[645]: INFO GET /healthz 200 2ms",
    );
    expect(sh("journalctl --since '1 hour ago' -n 2").split("\n")).toHaveLength(2);
    expect(sh("journalctl -u licd --since '10 minutes ago' -n 2").split("\n")).toHaveLength(2);
    expect(sh("journalctl -g healthz -n 1")).toContain("licd[645]");
    expect(sh("journalctl --list-boots").split("\n")).toHaveLength(2);
    expect(sh("journalctl --disk-usage")).toBe(
      "Archived and active journals take up 128.0M in the file system.",
    );
    expect(sh("journalctl -b -n 1")).toContain("licd[645]");
  });

  test("an option the fake does not have is outside it, and -f says it shows the lines so far", () => {
    const { run } = lab();
    expect(run("srv-a2", "journalctl -t sshd -n 2")).toMatchObject({
      exitCode: 2,
      outside: ["journalctl -t"],
    });
    expect(run("srv-a2", "journalctl --vacuum-size=100M").outside).toEqual([
      "journalctl --vacuum-size=100M",
    ]);
    const follow = run("srv-a2", "journalctl -f");
    expect(follow.stderr).toContain("-f는 이 흉내에서 안 돼요");
    expect(follow.stdout).toContain("licd[645]");
  });

  test("dmesg prints the kernel ring buffer with its boot-relative stamps, -T with dates", () => {
    const { sh, run } = lab();
    expect(sh("dmesg").split("\n")[0]).toBe(
      "[    0.000000] Linux version 5.14.0-427.el9.x86_64 (mockbuild@x86-64-03) (gcc 11.4.1) #1 SMP PREEMPT_DYNAMIC",
    );
    expect(sh("dmesg -T").split("\n")[1]).toBe(
      "[Wed Dec 17 17:08:10 2025] Command line: BOOT_IMAGE=(hd0,msdos1)/vmlinuz-5.14.0-427.el9.x86_64 root=/dev/sda2 ro",
    );
    expect(sh("dmesg -l err")).toBe("");
    expect(sh("dmesg | tail -1")).toContain("EXT4-fs (sda2): mounted filesystem");
    expect(run("srv-a2", "dmesg -w").outside).toEqual(["dmesg -w"]);
  });
});

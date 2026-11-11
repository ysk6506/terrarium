/**
 * The error answers of the process and unit commands of the fake shell (REQ-098): the lines `ps`, `kill` and `systemctl`
 * print for a wrong column, a wrong signal, a process that is not there and a unit that is not there are the real tools'.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const HOST = "srv-a2";

describe("ps, kill and systemctl refuse in the words of the real tools [REQ-098]", () => {
  test("ps refuses a column it does not know, however the columns are asked for", () => {
    const { run } = lab();
    for (const cmd of ["ps -eo pid,bogus", "ps -o bogus"]) {
      expect(run(HOST, cmd)).toMatchObject({
        exitCode: 1,
        stderr: 'error: unknown user-defined format specifier "bogus"',
        stdout: "",
      });
    }
  });

  test("kill with nothing to kill prints its usage with exit 2, with a word that is no process it names the word", () => {
    const { run } = lab();
    const usage =
      "kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]";
    expect(run(HOST, "kill")).toMatchObject({ exitCode: 2, stderr: usage });
    expect(run(HOST, "kill -TERM")).toMatchObject({ exitCode: 2, stderr: usage });
    expect(run(HOST, "kill abc")).toMatchObject({
      exitCode: 1,
      stderr: "bash: kill: abc: arguments must be process or job IDs",
    });
  });

  test("a process that is not there is No such process, for a signal and for the test signal 0 alike", () => {
    const { run } = lab();
    for (const cmd of ["kill -9 99999", "kill -0 99999"])
      expect(run(HOST, cmd)).toMatchObject({
        exitCode: 1,
        stderr: "bash: kill: (99999) - No such process",
      });
  });

  test("systemctl cat prints the unit file under its path, and says No files found for a unit it does not have", () => {
    const { run, sh } = lab();
    const text = sh("systemctl cat licd");
    expect(text.split("\n")[0]).toBe("# /etc/systemd/system/licd.service");
    expect(text).toContain("[Service]");
    expect(text).toContain("ExecStart=/opt/app/bin/licd --config /etc/licd.conf");
    expect(run(HOST, "systemctl cat nonexistent")).toMatchObject({
      exitCode: 1,
      stderr: "No files found for nonexistent.service.",
    });
  });

  test("is-active of a unit that is not there is inactive with exit 3, and of a running one is active with exit 0", () => {
    const { run } = lab();
    expect(run(HOST, "systemctl is-active nonexistent")).toMatchObject({
      exitCode: 3,
      stdout: "inactive",
    });
    expect(run(HOST, "systemctl is-active licd")).toMatchObject({
      exitCode: 0,
      stdout: "active",
    });
    expect(run(HOST, "systemctl is-enabled licd").stdout).toBe("enabled");
  });
});

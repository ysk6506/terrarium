/**
 * What the shell does with `exit`, with `>` and with `2>` (REQ-098): an exit code that is a number, one that is not, a file
 * that is emptied by an empty write, errors sent to a file, appended to it, or to a place that cannot take them.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("exit and clear [REQ-098]", () => {
  test("[REQ-098] exit gives the code it is given, zero when it is given none or no number, and clear says nothing", () => {
    const { run } = lab();
    expect(run("srv-a2", "exit 3").exitCode).toBe(3);
    expect(run("srv-a2", "exit").exitCode).toBe(0);
    expect(run("srv-a2", "exit x").exitCode).toBe(0);
    expect(run("srv-a2", "clear")).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("redirecting output [REQ-098]", () => {
  test("[REQ-098] an empty write empties a file that had something, and appending adds to the end", () => {
    const { sh } = lab();
    sh("echo hi > /tmp/a");
    sh(": > /tmp/a");
    expect(sh("wc -c < /tmp/a")).toBe("0");
    sh("echo a > /tmp/b");
    sh("echo -n > /tmp/b");
    expect(sh("wc -c /tmp/b")).toBe("0 /tmp/b");
    sh("echo hi >> /tmp/n");
    sh("echo ho >> /tmp/n");
    expect(sh("cat /tmp/n")).toBe("hi\nho");
  });

  test("[REQ-098] a place that cannot take the write says why: a directory, a missing directory, a file of the system", () => {
    const { run } = lab();
    expect(run("srv-a2", "echo hi > /etc")).toMatchObject({
      stderr: "bash: /etc: Is a directory",
      exitCode: 1,
    });
    expect(run("srv-a2", "echo hi > /nope/x")).toMatchObject({
      stderr: "bash: /nope/x: Permission denied",
      exitCode: 1,
    });
    expect(run("srv-a2", "echo hi > /proc/version")).toMatchObject({
      stderr: "bash: /proc/version: Permission denied",
      exitCode: 1,
    });
  });
});

describe("redirecting errors [REQ-098]", () => {
  test("[REQ-098] errors go to a file, are appended to it on a second try, and are then not on the screen", () => {
    const { run, sh } = lab();
    expect(run("srv-a2", "ls /nosuch 2> /tmp/e")).toMatchObject({ stderr: "", stdout: "" });
    expect(sh("cat /tmp/e")).toBe("ls: cannot access '/nosuch': No such file or directory");
    sh("ls /nosuch2 2>> /tmp/e");
    expect(sh("cat /tmp/e")).toBe(
      "ls: cannot access '/nosuch': No such file or directory\nls: cannot access '/nosuch2': No such file or directory",
    );
  });

  test("[REQ-098] errors sent to a directory say so, and errors sent to the output come out with it", () => {
    const { run } = lab();
    expect(run("srv-a2", "ls /nosuch 2>/etc")).toMatchObject({
      stderr: "bash: /etc: Is a directory",
      exitCode: 2,
    });
    expect(run("srv-a2", "ls /nosuch 2>&1")).toMatchObject({
      stdout: "ls: cannot access '/nosuch': No such file or directory",
      stderr: "",
      exitCode: 2,
    });
  });
});

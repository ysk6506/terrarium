/**
 * The syntax of the fake shell (REQ-098, ADR-0117): the lines it runs for real, the syntax errors it prints in bash's
 * words, and the shell features it refuses in its own words and lists as outside it.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const HOST = "srv-a2";

describe("the shell prints bash's syntax errors for lines bash would refuse [REQ-098]", () => {
  test.each([
    ["; echo a", "`;'"],
    ["| cat", "`|'"],
    ["echo a | | cat", "`|'"],
    ["&& echo a", "`&&'"],
    ["echo a &&", "`newline'"],
  ])("%s", (line, token) => {
    const r = lab().run(HOST, line);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe(`bash: syntax error near unexpected token ${token}`);
    expect(r.stdout).toBe("");
  });

  test("an unterminated quote is the end of file bash looks for", () => {
    const { run } = lab();
    expect(run(HOST, 'echo "open').stderr).toBe(
      "bash: unexpected EOF while looking for matching `\"'",
    );
    expect(run(HOST, "echo 'open").stderr).toBe(
      "bash: unexpected EOF while looking for matching `''",
    );
    expect(run(HOST, "echo 'open").exitCode).toBe(2);
  });
});

describe("what the shell does not do is refused in its own words and listed as outside it [REQ-098]", () => {
  test.each([
    ['echo "a$HOME"', "셸 문법 $", "$"],
    ["echo `date`", "셸 문법 `", "`"],
    ["echo $(date)", "셸 문법 $", "$"],
    ["echo a &", "셸 문법 백그라운드 실행(&)", "백그라운드 실행(&)"],
    ["FOO=1 echo a", "셸 문법 변수", "변수"],
  ])("%s", (line, outside, what) => {
    const r = lab().run(HOST, line);
    expect(r.exitCode).toBe(2);
    expect(r.outside).toEqual([outside]);
    // ADR-0184: bash runs these, so the answer is the terrarium lines only (no `bash:` line of an error that is not real)
    expect(r.stderr.split("\n")[0]).toBe(
      `terrarium: 이 실험장은 bash의 ${what} 기능을 지원하지 않아요. 실제 bash에는 있어요.`,
    );
    expect(r.stderr).not.toContain("bash: ");
  });

  test("a line with if, for or while is refused word by word and each word is listed", () => {
    const { run } = lab();
    const r = run(HOST, "if true; then echo a; fi");
    expect(r.exitCode).toBe(2);
    expect(r.outside).toEqual(["셸 문법 if", "셸 문법 then", "셸 문법 fi"]);
    expect(run(HOST, "for i in 1 2; do echo x; done").outside).toEqual([
      "셸 문법 for",
      "셸 문법 do",
      "셸 문법 done",
    ]);
  });

  test("a command that does not exist is command not found, listed as outside, and exit 127", () => {
    // ADR-0184: `export` is a real bash builtin the fake shell lacks, so the answer is the terrarium lines only;
    // a word no host has is plain command not found
    const r = lab().run(HOST, "export FOO=1");
    expect(r).toMatchObject({ exitCode: 127, outside: ["export"] });
    expect(r.stderr.split("\n")[0]).toMatch(/^terrarium: 이 실험장은 export 명령을/);
    expect(r.stderr).not.toContain("command not found");
    expect(lab().run(HOST, "nosuchcmd-xyz")).toMatchObject({
      exitCode: 127,
      stderr: "bash: nosuchcmd-xyz: command not found",
      outside: ["nosuchcmd-xyz"],
    });
  });
});

describe("lines that bash runs are run for real: joins, redirections, the working directory [REQ-098]", () => {
  test("&& runs the next on success, || on failure, and ; always", () => {
    const { sh } = lab();
    expect(sh("true && echo a")).toBe("a");
    expect(sh("false && echo a")).toBe("");
    expect(sh("false || echo b")).toBe("b");
    expect(sh("true || echo b")).toBe("");
    expect(sh("false ; echo c")).toBe("c");
  });

  test("cd changes where the next command runs, with no argument goes home, and a missing directory is refused", () => {
    const { sh, run } = lab();
    expect(sh("cd /tmp && pwd")).toBe("/tmp");
    expect(sh("cd ; pwd")).toBe("/home/ops");
    expect(run(HOST, "cd /nonexistent")).toMatchObject({
      exitCode: 1,
      stderr: "bash: cd: /nonexistent: No such file or directory",
    });
    expect(run(HOST, "exit 3").exitCode).toBe(3);
  });

  test("~ is the home directory at the start of a word", () => {
    const { sh } = lab();
    expect(sh("echo ~")).toBe("/home/ops");
    expect(sh("echo ~/x")).toBe("/home/ops/x");
  });

  test("input comes from a file with <, a missing file is refused, and /dev/null takes everything", () => {
    const { sh, run } = lab();
    expect(sh("cat < /etc/hostname")).toBe("srv-a2");
    expect(run(HOST, "cat < /nonexistent")).toMatchObject({
      exitCode: 1,
      stderr: "bash: /nonexistent: No such file or directory",
    });
    expect(run(HOST, "echo hi > /dev/null")).toMatchObject({ exitCode: 0, stdout: "" });
  });

  test("> writes, >> appends, and an empty write truncates a file that had text", () => {
    const { sh } = lab();
    expect(sh("echo a > /tmp/s1 ; echo b >> /tmp/s1 ; cat /tmp/s1")).toBe("a\nb");
    expect(sh(": > /tmp/s1 ; cat /tmp/s1")).toBe("");
    expect(sh("echo c > /tmp/s1 ; cat /tmp/s1")).toBe("c");
  });

  test("which finds a command on the path and says where it looked when it cannot", () => {
    const { sh, run } = lab();
    expect(sh("which cat")).toBe("/usr/bin/cat");
    expect(run(HOST, "which nope")).toMatchObject({
      exitCode: 1,
      stderr: "/usr/bin/which: no nope in (/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin)",
    });
  });

  test("sudo runs the rest of the line, and alone it prints its usage", () => {
    const { sh, run } = lab();
    expect(sh("sudo echo a")).toBe("a");
    expect(run(HOST, "sudo")).toMatchObject({ exitCode: 1, stderr: "usage: sudo command" });
  });
});

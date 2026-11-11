/**
 * Corners of the text commands of the deep operating-system fake (REQ-098, ADR-0117 decision 4) that the larger specs do
 * not reach: no-argument forms, error exits, `test` expressions, `tee` into places that refuse a write. Expected text is
 * what the GNU tool prints for the same input.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("echo, cat, head, tail, wc [REQ-098]", () => {
  test("[REQ-098] echo with no words prints one line end, and -n alone prints nothing", () => {
    const { sh } = lab();
    expect(sh("echo | wc -c")).toBe("1");
    expect(sh("echo -n | wc -c")).toBe("0");
    expect(sh("echo -n; echo b")).toBe("b");
  });

  test("[REQ-098] cat -v shows a control character as ^X and delete as ^?, and leaves tab alone", () => {
    const { sh } = lab();
    expect(sh("printf 'a\x01b\x7fc\\td\\n' | cat -v")).toBe("a^Ab^?c\td");
    expect(sh("printf 'x\x1by\\n' | cat -v")).toBe("x^[y");
  });

  test("[REQ-098] head and tail refuse a line count that is not a number, and tail -n 0 prints nothing", () => {
    const { run, sh } = lab();
    sh("printf 'a\\nb\\nc\\n' > /tmp/t");
    expect(run("srv-a2", "head -n abc /tmp/t")).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: "head: invalid number of lines: 'abc'",
    });
    expect(run("srv-a2", "tail -n x2 /tmp/t")).toMatchObject({
      exitCode: 1,
      stderr: "tail: invalid number of lines: 'x2'",
    });
    expect(sh("tail -n 0 /tmp/t")).toBe("");
    expect(sh("tail -n +2 /tmp/t")).toBe("b\nc");
    expect(sh("head -n -1 /tmp/t")).toBe("a\nb");
  });

  test("[REQ-098] wc pads standard input to seven columns, a lone count is not padded, several files are padded to the digits of their sizes together", () => {
    const { sh } = lab();
    sh("printf 'a b\\nc\\n' > /tmp/w");
    expect(sh("printf 'a b\\nc\\n' | wc")).toBe("      2       3       6");
    expect(sh("printf 'a b\\nc\\n' | wc -l")).toBe("2");
    expect(sh("printf 'a b\\nc\\n' | wc -w")).toBe("3");
    expect(sh("wc -l /tmp/w")).toBe("2 /tmp/w");
    expect(sh("wc -l /tmp/w /tmp/w")).toBe(" 2 /tmp/w\n 2 /tmp/w\n 4 total");
  });
});

describe("tee [REQ-098]", () => {
  test("[REQ-098] tee -a to a file that is not there yet creates it, a missing directory is an error", () => {
    const { run, sh } = lab();
    expect(sh("echo one | tee -a /tmp/new")).toBe("one");
    expect(sh("cat /tmp/new")).toBe("one");
    expect(sh("echo two | tee -a /tmp/new")).toBe("two");
    expect(sh("cat /tmp/new")).toBe("one\ntwo");
    expect(run("srv-a2", "echo x | tee /tmp/nodir/x")).toMatchObject({
      exitCode: 1,
      stdout: "x",
      stderr: "tee: /tmp/nodir/x: No such file or directory",
    });
    expect(run("srv-a2", "echo x | tee /newfile")).toMatchObject({
      exitCode: 1,
      stderr: "tee: /newfile: Permission denied",
    });
  });

  test("[REQ-098] on a read-only file system tee says so, and /tmp stays writable", () => {
    const { run, sh, inject, physics } = lab();
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    expect(run("srv-a2", "echo x | tee /etc/motd")).toMatchObject({
      exitCode: 1,
      stdout: "x",
      stderr: "tee: /etc/motd: Read-only file system",
    });
    expect(sh("echo y | tee /tmp/ok")).toBe("y");
  });
});

describe("tr, cut, uniq, xargs [REQ-098]", () => {
  test("[REQ-098] tr -c turns everything outside the set into the last character of the second set", () => {
    const { sh } = lab();
    expect(sh("printf 'ab1 2c' | tr -c 'a-z' '_'")).toBe("ab___c");
    expect(sh("printf 'ab1 2c' | tr -cd 'a-z'")).toBe("abc");
    expect(sh("printf 'aabbcc' | tr -s 'a-b'")).toBe("abcc");
  });

  test("[REQ-098] cut needs a list and says so, and an unreadable file makes the exit code 1", () => {
    const { run, sh } = lab();
    sh("printf 'a,b,c\\n' > /tmp/c");
    expect(run("srv-a2", "cut -d, /tmp/c")).toMatchObject({
      exitCode: 1,
      stderr: "cut: you must specify a list of bytes, characters, or fields",
    });
    expect(run("srv-a2", "cut -f1 -d, /tmp/c /tmp/none")).toMatchObject({
      exitCode: 1,
      stdout: "a",
      stderr: "cut: /tmp/none: No such file or directory",
    });
    expect(sh("cut -f2- -d, /tmp/c")).toBe("b,c");
    expect(sh("cut -f1 -d, --complement /tmp/c")).toBe("b,c");
  });

  test("[REQ-098] uniq on a missing file exits 1 and prints what it could read", () => {
    const { run } = lab();
    expect(run("srv-a2", "uniq /tmp/none")).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: "uniq: /tmp/none: No such file or directory",
    });
  });

  test("[REQ-098] xargs with nothing to read runs the command once, or not at all with -r", () => {
    const { sh } = lab();
    expect(sh("printf '' | xargs echo none")).toBe("none");
    expect(sh("printf '' | xargs -n 2 echo none")).toBe("none");
    expect(sh("printf '' | xargs -r echo none")).toBe("");
    expect(sh("printf 'a b c' | xargs -n 2 echo")).toBe("a b\nc");
  });
});

describe("test and [ [REQ-098]", () => {
  test("[REQ-098] with no expression test is false, with one word it is true when the word is not empty", () => {
    const { run } = lab();
    expect(run("srv-a2", "test").exitCode).toBe(1);
    expect(run("srv-a2", "[ ]").exitCode).toBe(1);
    expect(run("srv-a2", "[ x ]").exitCode).toBe(0);
    expect(run("srv-a2", "[ '' ]").exitCode).toBe(1);
  });

  test("[REQ-098] -o is true when either side is, -a when both are, and a side that is not understood is counted outside", () => {
    const { run } = lab();
    expect(run("srv-a2", "[ -f /nonexistent -o -d /tmp ]").exitCode).toBe(0);
    expect(run("srv-a2", "[ -f /nonexistent -o -d /nonexistent ]").exitCode).toBe(1);
    expect(run("srv-a2", "[ -d /tmp -a -e /etc ]").exitCode).toBe(0);
    expect(run("srv-a2", "[ -d /tmp -a -e /nonexistent ]").exitCode).toBe(1);
    expect(run("srv-a2", "[ -z a -o -q b ]")).toMatchObject({
      exitCode: 2,
      outside: ["[ -z a -o -q b"],
    });
  });
});

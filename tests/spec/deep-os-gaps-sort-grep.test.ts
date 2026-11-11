/**
 * Corners of `sort`, `grep` and the POSIX regular expressions of the deep operating-system fake (REQ-098, ADR-0117
 * decision 4): long options, keys past the end of a line, context separators, binary files, and the errors. Expected text
 * is what the GNU tool prints for the same input.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("sort [REQ-098]", () => {
  test("[REQ-098] the long options do what the letters do", () => {
    const { sh } = lab();
    sh("printf '10\\n9\\nB\\na\\n' > /tmp/s");
    expect(sh("sort --numeric-sort /tmp/s")).toBe("B\na\n9\n10");
    expect(sh("sort --reverse /tmp/s")).toBe("a\nB\n9\n10");
    expect(sh("sort --ignore-case /tmp/s")).toBe("10\n9\na\nB");
    expect(sh("sort --numeric-sort --reverse /tmp/s")).toBe("10\n9\na\nB");
    sh("printf '2K\\n1M\\n500\\nabc\\n' > /tmp/h");
    expect(sh("sort --human-numeric-sort /tmp/h")).toBe("abc\n500\n2K\n1M");
    expect(sh("sort -h /tmp/h")).toBe("abc\n500\n2K\n1M");
    sh("printf 'v1.10\\nv1.9\\n\\n' > /tmp/v");
    expect(sh("sort --version-sort /tmp/v")).toBe("\nv1.9\nv1.10");
  });

  test("[REQ-098] a key past the last word of a line is empty, and sorts first", () => {
    const { sh } = lab();
    sh("printf 'a z\\nb\\nc y\\n' > /tmp/k");
    expect(sh("sort -k2 /tmp/k")).toBe("b\nc y\na z");
    expect(sh("sort -k1,2 /tmp/k")).toBe("a z\nb\nc y");
  });

  test("[REQ-098] -o to a place that refuses a write says why, and a missing input still sorts the rest and exits 2", () => {
    const { run, sh, inject, physics } = lab();
    sh("printf 'b\\na\\n' > /tmp/s");
    const missing = run("srv-a2", "sort -o /tmp/out /tmp/none /tmp/s");
    expect(missing).toMatchObject({ exitCode: 2, stdout: "" });
    expect(missing.stderr).toContain("/tmp/none: No such file or directory");
    expect(sh("cat /tmp/out")).toBe("a\nb");
    expect(run("srv-a2", "sort -o /newfile /tmp/s")).toMatchObject({
      exitCode: 2,
      stderr: "sort: open failed: /newfile: Permission denied",
    });
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    expect(run("srv-a2", "sort -o /etc/motd /tmp/s")).toMatchObject({
      exitCode: 2,
      stderr: "sort: open failed: /etc/motd: Read-only file system",
    });
  });
});

describe("grep [REQ-098]", () => {
  const SETUP =
    "printf 'a\\nx\\ny\\nz\\na\\n' > /tmp/c; printf 'foo\\n' > /tmp/f; printf 'bar\\n' > /tmp/b";

  test("[REQ-098] a pattern that is not a regular expression exits 2, no pattern at all prints the usage", () => {
    const { run } = lab();
    expect(run("srv-a2", "grep -E '(' /etc/hosts")).toMatchObject({
      exitCode: 2,
      stderr: "grep: Invalid regular expression",
    });
    expect(run("srv-a2", "grep")).toMatchObject({
      exitCode: 2,
      stderr: "Usage: grep [OPTION]... PATTERNS [FILE]...",
    });
  });

  test("[REQ-098] context groups that are not next to each other are cut by --, with or without -o", () => {
    const { sh } = lab();
    sh(SETUP);
    expect(sh("grep -A1 a /tmp/c")).toBe("a\nx\n--\na");
    expect(sh("grep -n -B1 a /tmp/c")).toBe("1:a\n--\n4-z\n5:a");
    expect(sh("grep -o -A1 a /tmp/c")).toBe("a\n--\na");
    expect(sh("grep -c a /tmp/c")).toBe("2");
  });

  test("[REQ-098] -L lists the files without a match, -l the files with one", () => {
    const { sh, run } = lab();
    sh(SETUP);
    expect(sh("grep -L foo /tmp/f /tmp/b")).toBe("/tmp/b");
    expect(sh("grep -l foo /tmp/f /tmp/b")).toBe("/tmp/f");
    expect(run("srv-a2", "grep -L foo /tmp/f").stdout).toBe("");
  });

  test("[REQ-098] a binary file is reported, not printed, and -s keeps the missing-file complaint quiet", () => {
    const { sh, run } = lab();
    sh("printf '\x7fELF foo\\n' > /tmp/bin");
    expect(sh("grep foo /tmp/bin")).toBe("Binary file /tmp/bin matches");
    expect(sh("grep zzz /tmp/bin")).toBe("");
    expect(run("srv-a2", "grep -s foo /tmp/none")).toMatchObject({ exitCode: 2, stderr: "" });
    expect(run("srv-a2", "grep foo /tmp/none")).toMatchObject({
      exitCode: 2,
      stderr: "grep: /tmp/none: No such file or directory",
    });
  });
});

describe("regular expressions [REQ-098]", () => {
  test("[REQ-098] a ] first in a bracket is a member, and a backslash or [ inside one is itself", () => {
    const { sh } = lab();
    sh("printf 'a]b\\n' > /tmp/r1; printf 'a\\\\b\\n' > /tmp/r2; printf 'a[b\\n' > /tmp/r3");
    expect(sh("grep -o '[]]' /tmp/r1")).toBe("]");
    expect(sh("grep -o '[^]a]' /tmp/r1")).toBe("b");
    expect(sh("grep -o '[\\]' /tmp/r2")).toBe("\\");
    expect(sh("grep -o '[[]' /tmp/r3")).toBe("[");
  });

  test("[REQ-098] \\< and \\> are word edges", () => {
    const { sh, run } = lab();
    sh("printf 'foo bar\\n' > /tmp/w; printf 'foobar\\n' > /tmp/w2");
    expect(sh("grep -o '\\<foo\\>' /tmp/w")).toBe("foo");
    expect(run("srv-a2", "grep -o '\\<foo\\>' /tmp/w2").exitCode).toBe(1);
    expect(sh("grep -o 'bar\\>' /tmp/w2")).toBe("bar");
  });

  test("[REQ-098] + ? | ( ) { } are plain characters in a basic expression and operators in an extended one", () => {
    const { sh, run } = lab();
    sh("printf 'a+b\\naab\\n' > /tmp/p");
    expect(sh("grep 'a+b' /tmp/p")).toBe("a+b");
    expect(sh("grep -E 'a+b' /tmp/p")).toBe("aab");
    expect(sh("grep 'a\\+b' /tmp/p")).toBe("aab");
    expect(sh("grep -E 'a\\+b' /tmp/p")).toBe("a+b");
    expect(run("srv-a2", "grep 'a|b' /tmp/p").exitCode).toBe(1);
    expect(sh("grep -E 'a|b' /tmp/p | wc -l")).toBe("2");
    expect(sh("grep 'a\\|zz' /tmp/p | wc -l")).toBe("2");
    expect(sh("grep -E 'a\\|b' /tmp/p | wc -l")).toBe("0");
  });
});

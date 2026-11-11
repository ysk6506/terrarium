import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

/** Expected text was produced by the real GNU coreutils (LC_ALL=C) on the same input. */
const SETUP = "printf 'a b\\n\\nc\\tz\\n' > /tmp/f; printf 'x\\ny\\n' > /tmp/g; ";

const CASES: ReadonlyArray<readonly [string, string]> = [
  ["cat -n /tmp/f", "     1\ta b\n     2\t\n     3\tc\tz"],
  ["cat -b /tmp/f", "     1\ta b\n\n     2\tc\tz"],
  ["cat -A /tmp/f", "a b$\n$\nc^Iz$"],
  ["printf 'a\\n\\n\\n\\nb\\n' | cat -s -E", "a$\n$\nb$"],
  ["printf '%s=%d\\n' a 1 b 2", "a=1\nb=2"],
  ["printf '%c|%b\\n' xyz 'a\\tb'", "x|a\tb"],
  ["printf '%5.1f|%-3s|\\n' 3.14159 x", "  3.1|x  |"],
  ["wc -L /tmp/f", "9 /tmp/f"],
  ["wc -l /tmp/f /tmp/g", " 3 /tmp/f\n 2 /tmp/g\n 5 total"],
  ["wc /tmp/f", "3 4 9 /tmp/f"],
  ["printf 'a b c\\n' | wc -w", "3"],
  ["echo a:b:c | cut -d: --complement -f2", "a:c"],
  ["printf 'a 1\\nb 1\\nc 2\\n' | uniq -f1", "a 1\nc 2"],
  ["printf 'abx\\nabY\\nzz\\n' | uniq -w2", "abx\nzz"],
  ["test -f /tmp/f -a -f /tmp/g && echo yes", "yes"],
  ["test ! -f /tmp/nope -o -f /tmp/nope && echo yes", "yes"],
  ["[ 3 -gt 2 -a 1 -eq 1 ] && echo yes", "yes"],
  ["head -q -n1 /tmp/f /tmp/g", "a b\nx"],
  ["tail -q -n1 /tmp/f /tmp/g", "c\tz\ny"],
  ["find /tmp -name f -o -name g", "/tmp/f\n/tmp/g"],
  ["find /tmp ! -name f -type f -name '?'", "/tmp/g"],
  ["find /tmp -path '/tmp/g' -exec echo hit {} ';'", "hit /tmp/g"],
];

describe("the fake text commands print what GNU coreutils print [REQ-098]", () => {
  test.each(CASES)("%s", (cmd, expected) => {
    const { sh } = lab();
    expect(sh(`${SETUP}${cmd}`)).toBe(expected);
  });

  test("tee names a directory that is not there, and printf without a format is a usage error [REQ-098]", () => {
    const { run } = lab();
    expect(run("srv-a2", "echo hi | tee /tmp/nodir/x")).toMatchObject({
      stdout: "hi",
      stderr: "tee: /tmp/nodir/x: No such file or directory",
      exitCode: 1,
    });
    expect(run("srv-a2", "printf").exitCode).toBe(2);
  });
});

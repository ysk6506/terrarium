/**
 * How `find` and `sed` read what they are told (REQ-098): a size test with a sign and a unit, depth limits, empty files and
 * directories, a command run on each hit; and the places of a sed script a person gets wrong, each said in words.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const TREE = "mkdir -p /tmp/q/e; printf 'Abc\\nxyz\\nabc\\n' > /tmp/q/f; : > /tmp/q/z";

describe("find [REQ-098]", () => {
  test("[REQ-098] a size test with a plus is larger, with a unit it is counted in that unit, and zero bytes is empty", () => {
    const { sh } = lab();
    sh(TREE);
    expect(sh("find /tmp/q -type f -size +1k")).toBe("");
    expect(sh("find /tmp/q -type d -size +1k")).toBe("/tmp/q\n/tmp/q/e");
    expect(sh("find /tmp/q -size +2")).toBe("/tmp/q\n/tmp/q/e");
    expect(sh("find /tmp/q -size +1M")).toBe("");
    expect(sh("find /tmp/q/z /tmp/q/f -size 0c")).toBe("/tmp/q/z");
    expect(sh("find /tmp/q/f -size 12c")).toBe("/tmp/q/f");
  });

  test("[REQ-098] an empty file and an empty directory are both empty, a directory with something in it is not", () => {
    const { sh } = lab();
    sh(TREE);
    expect(sh("find /tmp/q -empty")).toBe("/tmp/q/e\n/tmp/q/z");
  });

  test("[REQ-098] depth limits keep the start out or keep to it, and one with no number is taken as zero", () => {
    const { sh } = lab();
    sh(TREE);
    expect(sh("find /tmp/q -maxdepth 0")).toBe("/tmp/q");
    expect(sh("find /tmp/q -mindepth 1 -maxdepth 1")).toBe("/tmp/q/e\n/tmp/q/f\n/tmp/q/z");
    // ADR-0184: the real find refuses a depth with no number, so the fake no longer takes it as zero
    expect(sh("find /tmp/q -maxdepth 2>&1")).toBe("find: missing argument to `-maxdepth'");
  });

  test("[REQ-098] a test left hanging, or a word that follows a finished test, is turned back with that word", () => {
    const { sh } = lab();
    sh(TREE);
    // ADR-0184: a dangling operator or a stray word is a mistake the real find refuses in its own words, with no hint
    for (const word of ["-a", "-o", "("])
      expect(sh(`find /tmp/q -name f ${word === "(" ? "\\(" : word} 2>&1`)).not.toContain(
        "terrarium:",
      );
    expect(sh("find /tmp/q -name f -a 2>&1")).toBe("find: unknown predicate `-a'");
    expect(sh("find /tmp/q -name f x 2>&1")).not.toContain("terrarium:");
  });

  test("[REQ-098] a command is run on each hit with the name put in, and what it says is what find says", () => {
    const { sh } = lab();
    sh(TREE);
    expect(sh("find /tmp/q -name f -exec echo got {} \\;")).toBe("got /tmp/q/f");
    expect(sh("find /tmp/q -type f -exec cat {} \\;")).toBe("Abc\nxyz\nabc");
    expect(sh("find /tmp/q/f -exec cat /nope{} \\; 2>&1")).toBe(
      "cat: /nope/tmp/q/f: No such file or directory",
    );
  });
});

describe("sed scripts [REQ-098]", () => {
  test("[REQ-098] an address may be a pattern in any case, a pattern between other marks, or the last line", () => {
    const { sh } = lab();
    sh(TREE);
    expect(sh("sed -n '/abc/I p' /tmp/q/f")).toBe("Abc\nabc");
    expect(sh("sed -n '\\,xyz,p' /tmp/q/f")).toBe("xyz");
    expect(sh("sed -n '$p' /tmp/q/f")).toBe("abc");
    expect(sh("sed -n '1,/xyz/p' /tmp/q/f")).toBe("Abc\nxyz");
    expect(sh("sed -n '/Abc/,$p' /tmp/q/f")).toBe("Abc\nxyz\nabc");
  });

  test("[REQ-098] a not and a block do what they say", () => {
    const { sh } = lab();
    sh(TREE);
    expect(sh("sed -n '2!p' /tmp/q/f")).toBe("Abc\nabc");
    expect(sh("sed -n '2{p;p}' /tmp/q/f")).toBe("xyz\nxyz");
  });

  test("[REQ-098] a script that is wrong in its form is turned back with the reason sed gives", () => {
    const { sh } = lab();
    sh(TREE);
    const refused = (script: string) => sh(`sed '${script}' /tmp/q/f 2>&1`);
    expect(refused("0p")).toBe("sed: -e expression #1, char 0: invalid usage of line address 0");
    expect(refused("1,p")).toBe("sed: -e expression #1, char 0: unexpected `,'");
    expect(refused("}")).toBe("sed: -e expression #1, char 0: unexpected `}'");
    expect(refused("{p")).toBe("sed: -e expression #1, char 0: unmatched `{'");
  });
});

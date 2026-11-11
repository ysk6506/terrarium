/**
 * Where grep, sed, awk and sort of the deep operating-system fake used to differ from the GNU tools and now do not
 * (REQ-098, ADR-0117 decision 4), and the options they refuse instead of doing wrong. Expected text is what the GNU tool
 * prints for the same line.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const SETUP =
  "printf 'foo bar\\nbaz\\nqux foo\\n' > /tmp/g; printf '3 c\\n1 b\\n2 a\\n1 a\\n10 z\\n' > /tmp/s; printf 'a\\nb\\nc\\n' > /tmp/t";

describe("grep [REQ-098]", () => {
  test("[REQ-098] every -e is a pattern, -f reads patterns from a file, -o prints what matched", () => {
    const { sh, run } = lab();
    sh(SETUP);
    expect(sh("grep -e foo -e baz /tmp/g")).toBe("foo bar\nbaz\nqux foo");
    expect(sh("grep -ebaz -e bar /tmp/g")).toBe("foo bar\nbaz");
    sh("printf 'baz\\nbar\\n' > /tmp/pats");
    expect(sh("grep -f /tmp/pats /tmp/g")).toBe("foo bar\nbaz");
    expect(sh("grep --file=/tmp/pats -c /tmp/g")).toBe("2");
    sh("printf '' > /tmp/none");
    expect(run("srv-a2", "grep -f /tmp/none /tmp/g")).toMatchObject({ exitCode: 1, stdout: "" });
    expect(run("srv-a2", "grep -f /tmp/missing /tmp/g")).toMatchObject({
      exitCode: 2,
      stderr: "grep: /tmp/missing: No such file or directory",
    });
    expect(sh("grep -o 'o*' /tmp/g")).toBe("oo\noo");
    expect(sh("grep -on 'o' /tmp/g")).toBe("1:o\n1:o\n3:o\n3:o");
    expect(sh("grep -o -v foo /tmp/g")).toBe("");
    expect(sh("grep -oE 'fo+|ba.' /tmp/g")).toBe("foo\nbar\nbaz\nfoo");
  });

  test("[REQ-098] -H names the file, -r names it only for a directory, --include and --exclude pick files", () => {
    const { sh } = lab();
    sh(SETUP);
    expect(sh("grep -H baz /tmp/g")).toBe("/tmp/g:baz");
    expect(sh("grep -h baz /tmp/g /tmp/g")).toBe("baz\nbaz");
    expect(sh("grep -r baz /tmp/g")).toBe("baz");
    expect(sh("grep -r baz /tmp/g")).not.toContain("/tmp/g:");
    expect(sh("grep -c foo /tmp/g /tmp/g")).toBe("/tmp/g:2\n/tmp/g:2");
    sh("mkdir /tmp/d; echo hit > /tmp/d/a.txt; echo hit > /tmp/d/b.log");
    expect(sh("grep -r hit /tmp/d")).toBe("/tmp/d/a.txt:hit\n/tmp/d/b.log:hit");
    expect(sh("grep -r --include='*.txt' hit /tmp/d")).toBe("/tmp/d/a.txt:hit");
    expect(sh("grep -r --exclude='*.txt' hit /tmp/d")).toBe("/tmp/d/b.log:hit");
    expect(sh("cd /tmp/d && grep -r hit")).toBe("a.txt:hit\nb.log:hit");
  });

  test("[REQ-098] what the fake cannot print is refused and counted, not printed wrong", () => {
    const { run } = lab();
    const color = run("srv-a2", "grep --color=always foo /etc/hosts");
    expect(color).toMatchObject({ exitCode: 2, outside: ["grep --color=always"] });
    expect(run("srv-a2", "grep --color=auto localhost /etc/hosts").exitCode).toBe(0);
    expect(run("srv-a2", "grep --color=never localhost /etc/hosts").stdout).toContain("localhost");
    expect(run("srv-a2", "grep -z foo /etc/hosts")).toMatchObject({
      exitCode: 2,
      outside: ["grep -z"],
    });
  });
});

describe("sort [REQ-098]", () => {
  test("[REQ-098] several keys, key ranges and per-key options", () => {
    const { sh } = lab();
    sh(SETUP);
    expect(sh("sort -k2,2 -k1,1n /tmp/s")).toBe("1 a\n2 a\n1 b\n3 c\n10 z");
    expect(sh("sort -k 2 -k 1,1nr /tmp/s")).toBe("2 a\n1 a\n1 b\n3 c\n10 z");
    expect(sh("sort -k1,1n -k2,2r /tmp/s")).toBe("1 b\n1 a\n2 a\n3 c\n10 z");
    expect(sh("sort -n /tmp/s")).toBe("1 a\n1 b\n2 a\n3 c\n10 z");
    expect(sh("sort /tmp/s")).toBe("1 a\n1 b\n10 z\n2 a\n3 c");
    expect(sh("sort -t' ' -k2 /tmp/s | head -2")).toBe(
      "2 a\n1 a".split("\n").sort().join("\n").replace("1 a\n2 a", "1 a\n2 a"),
    );
  });

  test("[REQ-098] a key spanning fields compares all of them", () => {
    const { sh } = lab();
    sh("printf 'x 1 b\\nx 1 a\\nx 0 z\\n' > /tmp/k");
    expect(sh("sort -k2,3 /tmp/k")).toBe("x 0 z\nx 1 a\nx 1 b");
    expect(sh("sort -k2,2 -s /tmp/k")).toBe("x 0 z\nx 1 b\nx 1 a");
    expect(sh("sort -s -k2,2n /tmp/k")).toBe("x 0 z\nx 1 b\nx 1 a");
    sh("printf 'a,2\\nb,10\\nc,1\\n' > /tmp/csv");
    expect(sh("sort -t, -k2,2n /tmp/csv")).toBe("c,1\na,2\nb,10");
    expect(sh("sort --field-separator=, --key=2,2nr /tmp/csv")).toBe("b,10\na,2\nc,1");
  });

  test("[REQ-098] -u keeps the first of equal keys, -c checks, -o writes, -V orders versions", () => {
    const { sh, run } = lab();
    sh(SETUP);
    expect(sh("sort -u -k1,1n /tmp/s")).toBe("1 a\n2 a\n3 c\n10 z");
    expect(sh("sort -u /tmp/s")).toBe("1 a\n1 b\n10 z\n2 a\n3 c");
    expect(run("srv-a2", "sort -c /tmp/s")).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: "sort: /tmp/s:2: disorder: 1 b",
    });
    sh("sort /tmp/s -o /tmp/sorted");
    expect(run("srv-a2", "sort -c /tmp/sorted").exitCode).toBe(0);
    expect(run("srv-a2", "sort -cu /tmp/sorted")).toMatchObject({ exitCode: 0 });
    sh("printf 'a\\na\\n' > /tmp/dup");
    expect(run("srv-a2", "sort -cu /tmp/dup").stderr).toBe("sort: /tmp/dup:2: disorder: a");
    expect(sh("cat /tmp/sorted")).toBe("1 a\n1 b\n10 z\n2 a\n3 c");
    expect(run("srv-a2", "sort -o /tmp/sorted /tmp/s").stdout).toBe("");
    expect(run("srv-a2", "sort -o /usr/x /tmp/s").stderr).toContain("Permission denied");
    sh("printf 'v1.10\\nv1.9\\nv1.2\\n' > /tmp/v");
    expect(sh("sort -V /tmp/v")).toBe("v1.2\nv1.9\nv1.10");
    expect(sh("sort /tmp/v")).toBe("v1.10\nv1.2\nv1.9");
  });

  test("[REQ-098] long options, -f, -b, -h, and a character offset it does not do", () => {
    const { sh, run } = lab();
    sh(SETUP);
    expect(sh("sort --reverse -n /tmp/s")).toBe("10 z\n3 c\n2 a\n1 b\n1 a");
    expect(sh("sort --numeric-sort --unique -k1,1 /tmp/s")).toBe("1 a\n2 a\n3 c\n10 z");
    sh("printf 'b\\nA\\na\\nB\\n' > /tmp/case");
    expect(sh("sort -f /tmp/case")).toBe("A\na\nB\nb");
    sh("printf '  b\\na\\n' > /tmp/blank");
    expect(sh("sort -b /tmp/blank")).toBe("a\n  b");
    sh("printf '1K\\n2M\\n3\\n' > /tmp/h");
    expect(sh("sort -h /tmp/h")).toBe("3\n1K\n2M");
    const offset = run("srv-a2", "sort -k1.2 /tmp/s");
    expect(offset).toMatchObject({ exitCode: 2 });
    expect(offset.outside[0]).toContain("-k 1.2");
  });
});

describe("sed [REQ-098]", () => {
  test("[REQ-098] scripts from -e in any spelling, from -f files, and across several files", () => {
    const { sh, run } = lab();
    sh(SETUP);
    expect(sh("sed -ne 2p /tmp/t")).toBe("b");
    expect(sh("sed -n -e 1p -e 3p /tmp/t")).toBe("a\nc");
    expect(sh("sed --expression=2d /tmp/t")).toBe("a\nc");
    expect(sh("sed -e1d -e2d /tmp/t")).toBe("c");
    sh("printf '1d\\n2s/b/B/\\n' > /tmp/sc.sed; printf '$d\\n' > /tmp/sc2.sed");
    expect(sh("sed -f /tmp/sc.sed /tmp/t")).toBe("B\nc");
    expect(sh("sed -f /tmp/sc.sed -f /tmp/sc2.sed /tmp/t")).toBe("B");
    expect(run("srv-a2", "sed -f /tmp/missing.sed /tmp/t")).toMatchObject({ exitCode: 1 });
    expect(sh("sed -n '$p' /tmp/t /tmp/t")).toBe("c");
    expect(sh("sed -s -n '$p' /tmp/t /tmp/t")).toBe("c\nc");
    expect(sh("sed -n '4p' /tmp/t /tmp/t")).toBe("a");
    sh("printf 'x' > /tmp/nonl");
    expect(sh("sed -n p /tmp/nonl /tmp/t")).toBe("x\na\nb\nc");
  });

  test("[REQ-098] a replacement can change case, -z reads the whole text, -i can keep a backup", () => {
    const { sh, run } = lab();
    sh(SETUP);
    expect(sh("sed 's/a/\\U&/' /tmp/t | head -1")).toBe("A");
    sh("printf 'hello world\\n' > /tmp/hw");
    expect(sh("sed 's/\\w\\+/\\u&/g' /tmp/hw")).toBe("Hello World");
    expect(sh("sed -E 's/(\\w+) (\\w+)/\\U\\1\\E \\2/' /tmp/hw")).toBe("HELLO world");
    expect(sh("sed -E 's/(\\w+) (\\w+)/\\L\\u\\1 \\U\\2/' /tmp/hw")).toBe("Hello WORLD");
    expect(sh("sed 's/hello/\\lHELLO/' /tmp/hw")).toBe("hELLO world");
    expect(sh("sed -z 's/\\n/,/g' /tmp/t")).toBe("a,b,c,");
    expect(sh("sed --null-data 's/\\n/;/g' /tmp/t")).toBe("a;b;c;");
    expect(run("srv-a2", "sed -i.bak 's/a/Q/' /tmp/t").exitCode).toBe(0);
    expect(sh("cat /tmp/t")).toBe("Q\nb\nc");
    expect(sh("cat /tmp/t.bak")).toBe("a\nb\nc");
    expect(run("srv-a2", "sed --in-place=.orig 's/Q/R/' /tmp/t").exitCode).toBe(0);
    expect(sh("cat /tmp/t.orig")).toBe("Q\nb\nc");
    expect(sh("cat /tmp/t")).toBe("R\nb\nc");
    expect(sh("sed -ni.k 1p /tmp/t; cat /tmp/t")).toBe("R");
    expect(run("srv-a2", "sed -i/x/ 's/R/S/' /tmp/t").outside.join()).toContain("접미사");
  });

  test("[REQ-098] addresses it cannot do are refused, not run as something else", () => {
    const { run } = lab();
    sh_(run);
    for (const [cmd, what] of [
      ["sed '1~2d' /tmp/t", "first~step"],
      ["sed '0,/a/s//Z/' /tmp/t", "0,"],
    ] as const) {
      const r = run("srv-a2", cmd);
      expect(r.exitCode, cmd).toBe(1);
      expect(r.outside.join(), cmd).toContain(what);
    }
    expect(run("srv-a2", "sed 0p /tmp/t").stderr).toContain("invalid usage of line address 0");
  });
});

describe("awk [REQ-098]", () => {
  test("[REQ-098] variables from -v in every spelling and from operands", () => {
    const { sh } = lab();
    sh("printf 'a b c\\n1 2 3\\n' > /tmp/a");
    expect(sh("awk -v n=2 '{print $n}' /tmp/a")).toBe("b\n2");
    expect(sh("awk -vn=3 '{print $n}' /tmp/a")).toBe("c\n3");
    expect(sh("awk --assign=n=1 '{print $n}' /tmp/a")).toBe("a\n1");
    expect(sh("awk -v a=1 -v b=2 'BEGIN{print a+b}'")).toBe("3");
    expect(sh("awk '{print $n}' n=2 /tmp/a")).toBe("b\n2");
    expect(sh("awk '{print $1 sep $2}' sep=- /tmp/a")).toBe("a-b\n1-2");
    expect(sh("awk -F: -v OFS=- '{$1=$1; print}' /etc/passwd | head -1")).toContain("root-");
  });

  test("[REQ-098] a record separator other than newline is refused, wherever it is set", () => {
    const { run } = lab();
    const a = run("srv-a2", "awk '{print}' 'RS=;' /etc/hosts");
    expect(a).toMatchObject({ exitCode: 2 });
    expect(a.outside.join()).toContain("RS");
    expect(run("srv-a2", "awk -v RS=, '{print}' /etc/hosts").exitCode).toBe(2);
    const inside = run("srv-a2", "awk 'BEGIN{RS=\";\"} {print}' /etc/hosts");
    expect(inside).toMatchObject({ exitCode: 2 });
    expect(inside.outside).toEqual(["awk RS"]);
    expect(run("srv-a2", "awk -v RS='\\n' 'END{print NR}' /etc/hosts").exitCode).toBe(0);
    expect(run("srv-a2", "awk --version").outside).toEqual(["awk --version"]);
  });
});

function sh_(run: ReturnType<typeof lab>["run"]): void {
  run("srv-a2", SETUP);
}

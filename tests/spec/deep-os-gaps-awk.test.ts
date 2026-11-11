/**
 * Corners of the small `awk` and its number formatting in the deep operating-system fake (REQ-098, ADR-0117 decision 4):
 * regular expressions given as strings, loops left by break, next and exit, and %g and zero padding. Expected text is what
 * gawk prints for the same program.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("awk functions and loops [REQ-098]", () => {
  test("[REQ-098] sub, gsub and match take the pattern from a string as well as from a /regex/", () => {
    const { sh } = lab();
    expect(sh(`awk 'BEGIN { s = "foo boo"; n = sub("o+", "0", s); print n, s }'`)).toBe("1 f0 boo");
    expect(sh(`awk 'BEGIN { s = "foo boo"; n = gsub("o+", "0", s); print n, s }'`)).toBe("2 f0 b0");
    expect(sh(`awk 'BEGIN { s = "foo boo"; n = gsub(/o/, "[&]", s); print n, s }'`)).toBe(
      "4 f[o][o] b[o][o]",
    );
    expect(sh(`awk 'BEGIN { print match("xxabbb", "ab+"), RSTART, RLENGTH }'`)).toBe("3 3 4");
    expect(sh(`awk 'BEGIN { print match("xx", "ab+"), RSTART, RLENGTH }'`)).toBe("0 0 -1");
  });

  test("[REQ-098] srand() with no argument seeds and returns the seed before", () => {
    const { sh } = lab();
    expect(sh(`awk 'BEGIN { srand(7); print srand() }'`)).toBe("7");
  });

  test("[REQ-098] calling a function that was never defined is a syntax error, said once", () => {
    const { run } = lab();
    const r = run("srv-a2", `awk 'BEGIN { print nosuch(1) }'`);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("nosuch");
  });

  test("[REQ-098] break leaves a while or a for loop, and the program goes on after it", () => {
    const { sh } = lab();
    expect(sh(`awk 'BEGIN { i = 0; while (1) { if (++i > 2) break }; print i }'`)).toBe("3");
    expect(sh(`awk 'BEGIN { for (i = 0; ; i++) { if (i == 4) break }; print i }'`)).toBe("4");
    expect(sh(`awk 'BEGIN { do { i++; if (i == 2) break } while (1); print i }'`)).toBe("2");
  });

  test("[REQ-098] next inside a loop skips to the next record, exit inside a loop ends the program", () => {
    const { sh } = lab();
    sh("printf '1\\n2\\n3\\n' > /tmp/n");
    expect(sh(`awk '{ while (1) { if ($1 == 2) next; break }; print }' /tmp/n`)).toBe("1\n3");
    expect(sh(`awk '{ for (;;) { if ($1 == 2) next; break }; print }' /tmp/n`)).toBe("1\n3");
    expect(sh(`awk '{ do { if ($1 == 2) next } while (0); print }' /tmp/n`)).toBe("1\n3");
    expect(sh(`awk '{ for (k in a) next; print }' /tmp/n`)).toBe("1\n2\n3");
    expect(sh(`awk 'BEGIN { while (1) { exit } } END { print "end" }'`)).toBe("end");
    expect(sh(`awk 'BEGIN { for (;;) { exit } } END { print "end" }'`)).toBe("end");
  });
});

describe("awk number formatting [REQ-098]", () => {
  test("[REQ-098] %g writes inf and -inf, whole numbers without a point, and a power of ten with its exponent", () => {
    const { sh } = lab();
    expect(sh(`awk 'BEGIN { printf "%g %g\\n", -log(0), log(0) }'`)).toBe("inf -inf");
    expect(sh(`awk 'BEGIN { printf "%g %g\\n", 100000, 123456 }'`)).toBe("100000 123456");
    expect(sh(`awk 'BEGIN { printf "%g %g %g\\n", 1e10, 1.5e10, 0.00001 }'`)).toBe(
      "1e+10 1.5e+10 1e-05",
    );
    expect(sh(`awk 'BEGIN { printf "%g\\n", 0.5 }'`)).toBe("0.5");
  });

  test("[REQ-098] zero padding goes after the sign, and a negative * width pads on the right", () => {
    const { sh } = lab();
    expect(sh(`awk 'BEGIN { printf "%05d|%+05d|%05d\\n", -42, 42, 42 }'`)).toBe(
      "-0042|+0042|00042",
    );
    expect(sh(`awk 'BEGIN { printf "%*d|%-*d|\\n", -5, 42, 5, 42 }'`)).toBe("42   |42   |");
    expect(sh(`awk 'BEGIN { printf "%5.1f|%-8s|%c\\n", 3.14159, "ab", "xyz" }'`)).toBe(
      "  3.1|ab      |x",
    );
  });
});

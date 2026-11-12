/**
 * The awk of the deep operating-system fake against the real awk (REQ-098, ADR-0117): programs that use the whole
 * language (patterns and ranges, operators, assignments, arrays, the string and math functions, printf, field and record
 * variables) and the text a real awk prints for them. Expected text was produced by running each program on
 * `printf 'alpha 1 x\\nbeta 22 y z\\n\\ngamma 3\\n'` with mawk; where gawk differs the program is left out.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const INPUT = "alpha 1 x\nbeta 22 y z\n\ngamma 3\n";

// [name, program, expected stdout, expected exit code]
const CASES: ReadonlyArray<readonly [string, string, string, number]> = [
  [
    "and-or",
    '{ if ($2 > 1 && $1 ~ /a$/) print "A" $1; if ($2 == 1 || NF > 3) print "B" $1 }',
    "Balpha\nAbeta\nBbeta\nAgamma\n",
    0,
  ],
  ["ternary", '{ print ($2 > 5 ? "big" : "small"), NF }', "small 3\nbig 4\nsmall 0\nsmall 2\n", 0],
  ["incdec", "BEGIN { i = 5; print i++, i, ++i, i--, --i, i }", "5 6 7 7 5 5\n", 0],
  [
    "incdec-field",
    "{ $2++; print; n[$1]--; print n[$1] }",
    "alpha 2 x\n-1\nbeta 23 y z\n-1\n 1\n-1\ngamma 4\n-1\n",
    0,
  ],
  [
    "sub-gsub",
    '{ s = $0; n = gsub(/a/, "[&]", s); m = sub(/^b/, "B", $1); print n, m, s, $0 }',
    "2 0 [a]lph[a] 1 x alpha 1 x\n1 1 bet[a] 22 y z Beta 22 y z\n0 0  \n2 0 g[a]mm[a] 3 gamma 3\n",
    0,
  ],
  [
    "gsub-dynamic",
    '{ pat = "[aeiou]"; gsub(pat, "_"); print }',
    "_lph_ 1 x\nb_t_ 22 y z\n\ng_mm_ 3\n",
    0,
  ],
  [
    "match",
    "{ print match($0, /[0-9]+/), RSTART, RLENGTH; print match($1, /zzz/), RSTART, RLENGTH }",
    "7 7 1\n0 0 -1\n6 6 2\n0 0 -1\n0 0 -1\n0 0 -1\n7 7 1\n0 0 -1\n",
    0,
  ],
  [
    "split",
    '{ n = split($0, p); print n, p[1], p[n]; n = split("a:b:c", q, ":"); print n, q[2]; n = split("a1b22c", r, /[0-9]+/); print n, r[3] }',
    "3 alpha x\n3 b\n3 c\n4 beta z\n3 b\n3 c\n0  \n3 b\n3 c\n2 gamma 3\n3 b\n3 c\n",
    0,
  ],
  [
    "index-case",
    '{ print index($0, "a"), toupper($1), tolower("ABC") }',
    "1 ALPHA abc\n4 BETA abc\n0  abc\n2 GAMMA abc\n",
    0,
  ],
  [
    "multi-in",
    'BEGIN { a[1,2] = 3; if ((1,2) in a) print "yes"; if (!((2,1) in a)) print "no"; delete a[1,2]; print length(a) }',
    "yes\nno\n0\n",
    0,
  ],
  ["delete-all", "BEGIN { a[1]; a[2]; delete a; print length(a) }", "0\n", 0],
  ["next", 'NR == 2 { next } { print NR ":" $1 }', "1:alpha\n3:\n4:gamma\n", 0],
  ["exit-code", '{ if (NR == 2) exit 3 } END { print "end", NR }', "end 2\n", 3],
  ["match-op", '$1 ~ "^g" { print "g" } $1 !~ /a/ { print "no-a" }', "no-a\ng\n", 0],
  ["compare", '{ print ($2 < 10), ($1 < "b"), ($2 == "22") }', "1 1 0\n0 0 1\n1 1 0\n1 0 0\n", 0],
  [
    "fields-beyond",
    '{ $(NF + 2) = "x"; print; print NF }',
    "alpha 1 x  x\n5\nbeta 22 y z  x\n6\n x\n2\ngamma 3  x\n4\n",
    0,
  ],
  ["nf-assign", "{ NF = 2; print; print NF }", "alpha 1\n2\nbeta 22\n2\n \n2\ngamma 3\n2\n", 0],
  ["unary", 'BEGIN { x = 4; print -x, !x, !0, +"3x", - -x }', "-4 0 1 3 4\n", 0],
  [
    "while-for",
    "BEGIN { i = 0; while (i < 3) { s = s i; i++ } for (j = 0; j < 3; j++) t = t j; for (;;) { k++; if (k > 2) break } print s, t, k }",
    "012 012 3\n",
    0,
  ],
  [
    "continue",
    'BEGIN { for (i = 0; i < 5; i++) { if (i % 2) continue; printf "%d ", i } print "" }',
    "0 2 4 \n",
    0,
  ],
  [
    "for-in-sorted",
    'BEGIN { a["x"] = 1; a["y"] = 2; n = 0; for (k in a) n += a[k]; print n }',
    "3\n",
    0,
  ],
  [
    "printf-forms",
    'BEGIN { printf "%5s|%-5s|%05d|%+d|%x|%o|%c|%c|%%|%.3s\\n", "ab", "cd", 42, 7, 255, 8, 65, "hello", "abcdef" }',
    "   ab|cd   |00042|+7|ff|10|A|h|%|abc\n",
    0,
  ],
  [
    "printf-float",
    'BEGIN { printf "%8.3f|%-8.2f|%e|%g|%g\\n", 3.14159, 2.5, 12345.678, 0.0001, 1e10 }',
    "   3.142|2.50    |1.234568e+04|0.0001|1e+10\n",
    0,
  ],
  [
    "substr-edges",
    'BEGIN { s = "hello"; print substr(s, 2), substr(s, 2, 2), substr(s, 10) "|", substr(s, 5, 10) }',
    "ello el | o\n",
    0,
  ],
  ["length-forms", "{ print length, length($1), length() }", "9 5 9\n11 4 11\n0 0 0\n7 5 7\n", 0],
  [
    "math",
    'BEGIN { print int(-3.7), int("4abc"), sqrt(16), exp(0), log(1), sin(0), cos(0), atan2(0, -1) }',
    "-3 4 4 1 0 0 1 3.14159\n",
    0,
  ],
  [
    "regex-classes",
    '{ if ($0 ~ /^[a-z]+ [0-9]+$/) print "ok"; if ($1 ~ /^(alpha|gamma)$/) print "AG"; if ($0 ~ /[[:digit:]]{2}/) print "two" }',
    "AG\ntwo\nok\nAG\n",
    0,
  ],
  ["uninit", 'BEGIN { print x + 0, x "", length(x), (x == 0), (x == "") }', "0  0 1 1\n", 0],
  [
    "assign-ops",
    "BEGIN { x = 10; x += 5; x -= 3; x *= 2; x /= 4; x %= 4; x ^= 2; print x }",
    "4\n",
    0,
  ],
  ["getline-free-end", "END { print NR, $0, NF }", "4 gamma 3 2\n", 0],
  ["begin-only", 'BEGIN { print "only" }', "only\n", 0],
  ["pattern-range", '/beta/,/gamma/ { print NR ": " $0 }', "2: beta 22 y z\n3: \n4: gamma 3\n", 0],
  ["regex-only-pattern", "/a/", "alpha 1 x\nbeta 22 y z\ngamma 3\n", 0],
  ["not-pattern", '!/a/ { print "X" $0 }', "X\n", 0],
  [
    "ofs-ors",
    'BEGIN { OFS = "-"; ORS = "!\\n" } { $1 = $1; print $1, $2 }',
    "alpha-1!\nbeta-22!\n-!\ngamma-3!\n",
    0,
  ],
  ["fs-tab-regex", 'BEGIN { FS = "[ ]+" } { print NF ":" $2 }', "3:1\n4:22\n0:\n2:3\n", 0],
  [
    "comma-list",
    "{ print $1, $2; print $1 $2; print($1)($2) }",
    "alpha 1\nalpha1\nalpha1\nbeta 22\nbeta22\nbeta22\n \n\n\ngamma 3\ngamma3\ngamma3\n",
    0,
  ],
  ["parenthesised-print", "{ print ($1, $2) }", "alpha 1\nbeta 22\n \ngamma 3\n", 0],
  ["semicolons", "BEGIN { a = 1; ; b = 2 ; print a, b }", "1 2\n", 0],
  [
    "else-if",
    '{ if ($2 < 2) print "low"; else if ($2 < 10) print "mid"; else print "high" }',
    "low\nhigh\nlow\nmid\n",
    0,
  ],
  ["regex-dynamic-split", '{ n = split($0, w, " "); print n }', "3\n4\n0\n2\n", 0],
  ["sprintf-var", 'BEGIN { s = sprintf("%s-%d", "a", 5); print s, length(s) }', "a-5 3\n", 0],
  ["neg-exponent", "BEGIN { print 2 ^ -1, 10 % 3, 1 / 4 }", "0.5 1 0.25\n", 0],
  ["compare-strnum", 'BEGIN { a = "10"; b = 9; print (a < b), (a + 0 < b) }', "1 0\n", 0],
  [
    "concat-num",
    'BEGIN { print 1 " " 2, 1 + 2 "" 3, 2 ^ 3 ^ 2, 7 % 4, -7 % 4 }',
    "1 2 33 512 3 -3\n",
    0,
  ],
  [
    "dollar-expr",
    "NF { i = 1; print $i, $(i + 1), $NF, $(NF - 1) }",
    "alpha 1 x 1\nbeta 22 z y\ngamma 3 3 gamma\n",
    0,
  ],
  ["string-escapes", 'BEGIN { print "a\\tb\\\\c\\"d" }', 'a\tb\\c"d\n', 0],
  ["number-out", "BEGIN { print 3.0, 3.10, 1e6, 1e-3, 0.1 + 0.2 }", "3 3.1 1000000 0.001 0.3\n", 0],
];

describe("awk programs print what the real awk prints [REQ-098]", () => {
  test.each(CASES)("[REQ-098] %s", (_name, program, stdout, code) => {
    const { run, sh } = lab();
    sh(`printf '${INPUT.replace(/\n/g, "\\n")}' > /tmp/in`);
    const r = run("srv-a2", `awk '${program}' /tmp/in`);
    expect(r.stdout).toBe(stdout.replace(/\n$/, ""));
    expect(r.exitCode).toBe(code);
  });
});

// [name, arguments after `awk`, expected stdout, expected exit code]; files /tmp/in, /tmp/in2 and /tmp/prog.awk are made first
const RUNS: ReadonlyArray<readonly [string, string, string, number]> = [
  [
    "truthy",
    '\'BEGIN { if ("0") print "s0"; if (0) print "n0"; if ("") print "e"; x = "a"; if (x) print "x"; if (!y) print "unset" } {} END { }\' /tmp/in',
    "s0\nx\nunset\n",
    0,
  ],
  ["strnum-truthy", '\'{ if ($1) print "t" NR; else print "f" NR }\' /tmp/in2', "t1\nt2\n", 0],
  [
    "compare-order",
    '\'BEGIN { print ("a" < "b"), ("abc" < "abd"), (10 < 9), ("10" < "9"), (1 == 1.0), ("a" == "a") }\'',
    "1 1 0 1 1 1\n",
    0,
  ],
  ["tab-fs-escape", "-F '\\t' '{ print $2 }' /tmp/in2", "b c\n\n", 0],
  ["pipe-fs", "-F '|' '{ print $2 }' /tmp/in2", "\n2\n", 0],
  ["pipe-fs-escaped", "-F '\\\\|' '{ print $3 }' /tmp/in2", "\n3\n", 0],
  ["v-escapes", "-v 's=a\\tb' 'BEGIN { print s }'", "a\tb\n", 0],
  ["v-number", "-v n=3 'BEGIN { print n + 1, n \"x\" }'", "4 3x\n", 0],
  ["arg-var", "'{ print x, $1 }' x=5 /tmp/in2", "5 a\n5 1|2|3\n", 0],
  ["regex-slash", '\'$0 ~ /a\\/b/ { print "hit" } END { print "done" }\' /tmp/in2', "done\n", 0],
  [
    "printf-percent",
    "'BEGIN { printf \"100%%|%5.1f|% d|%+5d|%-3d|\\n\", 2.55, 4, 4, 4 }'",
    "100%|  2.5| 4|   +4|4  |\n",
    0,
  ],
  ["printf-neg-star", "'BEGIN { printf \"%-*d|\\n\", 4, 7 }'", "7   |\n", 0],
  ["printf-u", "'BEGIN { printf \"%i %u %X\\n\", 3.9, 7, 255 }'", "3 7 FF\n", 0],
  ["printf-str-num", '\'BEGIN { printf "%d %s %s\\n", "12abc", 1.50, 1e3 }\'', "12 1.5 1000\n", 0],
  ["print-parens-gt", "'BEGIN { print (1 > 2), (2 > 1) }'", "0 1\n", 0],
  ["exit-end", '\'END { print "a"; exit 4; print "b" }\' /tmp/in', "a\n", 4],
  ["exit-begin-end", "'BEGIN { exit 2 } END { print \"end\" }' /tmp/in", "end\n", 2],
  ["exit-expr-only", "'BEGIN { exit } END { print \"e\" }'", "e\n", 0],
  ["range-same-line", "'/beta/,/beta/ { print NR }' /tmp/in", "2\n", 0],
  ["range-open", "'NR==2,NR==99 { print NR }' /tmp/in", "2\n3\n4\n", 0],
  ["nr-pattern", "'NR % 2 == 0' /tmp/in", "beta 22 y z\ngamma 3\n", 0],
  [
    "field-set-then-print",
    "'{ $3 = \"Z\"; print; print NF }' /tmp/in",
    "alpha 1 Z\n3\nbeta 22 Z z\n4\n  Z\n3\ngamma 3 Z\n3\n",
    0,
  ],
  ["regex-empty-record", "'/^$/ { print \"blank\", NR }' /tmp/in", "blank 3\n", 0],
  ["index-empty", '\'BEGIN { print index("abc", ""), index("", "a") }\'', "1 0\n", 0],
  ["length-array", "'BEGIN { a[1]; a[2]; a[3]; print length(a) }'", "3\n", 0],
  ["srand-return", "'BEGIN { srand(7); print srand(9) }'", "7\n", 0],
  [
    "sub-ampersand",
    "'{ sub(/a/, \"<&&>\"); print } ' /tmp/in",
    "<aa>lpha 1 x\nbet<aa> 22 y z\n\ng<aa>mma 3\n",
    0,
  ],
  [
    "sub-escaped-amp",
    "'{ gsub(/a/, \"\\\\&\"); print }' /tmp/in",
    "&lph& 1 x\nbet& 22 y z\n\ng&mm& 3\n",
    0,
  ],
  [
    "gsub-empty-match",
    '\'BEGIN { s = "abc"; n = gsub(/x*/, "-", s); print n, s }\'',
    "4 -a-b-c-\n",
    0,
  ],
  [
    "gsub-anchor",
    "'{ gsub(/^/, \">\"); print }' /tmp/in",
    ">alpha 1 x\n>beta 22 y z\n>\n>gamma 3\n",
    0,
  ],
  [
    "split-regex-sep",
    "'BEGIN { n = split(\"a, b,c\", p, /, */); print n, p[1] p[2] p[3] }'",
    "3 abc\n",
    0,
  ],
  ["split-empty", "'BEGIN { n = split(\"\", p); print n, length(p) }'", "0 0\n", 0],
  ["split-chars", '\'BEGIN { n = split("abc", p, ""); print n, p[1], p[3] }\'', "3 a c\n", 0],
  [
    "split-space-default",
    "'BEGIN { n = split(\"  a   b  \", p); print n, p[1], p[2] }'",
    "2 a b\n",
    0,
  ],
  ["while-break", "'BEGIN { while (1) { if (++i > 4) break } print i }'", "5\n", 0],
  [
    "nested-arrays",
    "'{ c[$1 FS NF]++ } END { n = 0; for (k in c) n++; print n }' /tmp/in",
    "4\n",
    0,
  ],
  [
    "in-operator",
    '\'BEGIN { a["x"]; print ("x" in a), ("y" in a); if ("y" in a) print "bad"; print length(a) }\'',
    "1 0\n1\n",
    0,
  ],
  ["delete-elem", "'BEGIN { a[1]; a[2]; delete a[1]; print length(a), (1 in a) }'", "1 0\n", 0],
  ["assign-expression", "'BEGIN { print (x = 5) + 1, x; y = z = 3; print y, z }'", "6 5\n3 3\n", 0],
  ["pre-post-array", "'BEGIN { a[1] = 1; print a[1]++, a[1], ++a[1], --a[1] }'", "1 2 3 2\n", 0],
  ["uminus-string", '\'BEGIN { x = "3"; print -x, +x, !x, - "abc" }\'', "-3 3 0 0\n", 0],
  ["exponent-assoc", "'BEGIN { print 2 ^ 3 ^ 2, -2 ^ 2, 2 ^ 0.5 }'", "512 -4 1.41421\n", 0],
  ["modulo-neg", "'BEGIN { print -7 % 3, 7 % -3, 7.5 % 2 }'", "-1 1 1.5\n", 0],
  ["concat-precedence", '\'BEGIN { print 1 + 2 " " 3 + 4, 1 " " -1 }\'', "3 7 1-1\n", 0],
  [
    "match-set-vars",
    "'BEGIN { s = \"foobar\"; if (match(s, /o+b/)) print RSTART, RLENGTH; print match(s, /^$/), RSTART, RLENGTH }'",
    "2 3\n0 0 -1\n",
    0,
  ],
  ["length-no-parens-record", "'length > 5' /tmp/in", "alpha 1 x\nbeta 22 y z\ngamma 3\n", 0],
  ["dash-f-file", "-f /tmp/prog.awk /tmp/in", "1:alpha\n2:beta\n3:\n4:gamma\n", 0],
];

// What the fake refuses or cannot do: a message on standard error and exit code 2 (a real awk is fatal on most of these too)
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ["division-zero", "'BEGIN { print 1 / 0 }'"],
  ["mod-zero", "'BEGIN { print 1 % 0 }'"],
  ["syntax-missing-brace", "'BEGIN { print 1'"],
  ["syntax-unterminated-string", "'BEGIN { print \"abc }'"],
  ["syntax-unterminated-regex", "'/abc { print }'"],
  ["syntax-bad-char", "'BEGIN { print 1 ` }'"],
  ["syntax-do-without-while", "'BEGIN { do print 1 }'"],
  ["syntax-delete", "'BEGIN { delete 5 }'"],
  ["syntax-in", "'BEGIN { print (1 in 5) }'"],
  ["syntax-unexpected", "'BEGIN { print ) }'"],
  ["syntax-end-of-program", "'BEGIN { x = }'"],
  ["missing-file", "'{ print }' /tmp/missing-file"],
  ["dash-f-missing", "-f /tmp/nope.awk /tmp/in"],
  ["sub-no-args", "'BEGIN { sub(/a/) }'"],
  ["match-one-arg", "'BEGIN { match(\"a\") }'"],
  ["split-no-array", "'BEGIN { split(\"a b\") }'"],
  ["unknown-function", "'BEGIN { nothere(1) }'"],
];

const FILES =
  "printf 'alpha 1 x\\nbeta 22 y z\\n\\ngamma 3\\n' > /tmp/in; printf 'a\\tb c\\td\\n1|2|3\\n' > /tmp/in2; printf '{ print NR \":\" $1 }\\n' > /tmp/prog.awk";

describe("awk run from the command line prints what the real awk prints [REQ-098]", () => {
  test.each(RUNS)("[REQ-098] %s", (_name, args, stdout, code) => {
    const { run, sh } = lab();
    sh(FILES);
    const r = run("srv-a2", `awk ${args}`);
    expect(r.stdout).toBe(stdout.replace(/\n$/, ""));
    expect(r.exitCode).toBe(code);
  });

  test.each(REFUSED)("[REQ-098] %s is refused with exit code 2 and a message", (_name, args) => {
    const { run, sh } = lab();
    sh(FILES);
    const r = run("srv-a2", `awk ${args}`);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/^awk: /);
    expect(r.stdout).toBe("");
  });

  test("[REQ-098] getline-simple is a gap: gawk runs it, so the answer is the terrarium lines only, exit 2 (ADR-0184)", () => {
    const { run, sh } = lab();
    sh(FILES);
    const r = run("srv-a2", "awk 'BEGIN { getline; print \"got\", $0 }' /tmp/in");
    expect(r.exitCode).toBe(2);
    expect(r.stderr.split("\n")[0]).toMatch(/^terrarium: 이 실험장은 awk의 getline 기능을/);
    expect(r.stderr).not.toMatch(/^awk: /m);
    expect(r.stdout).toBe("");
  });

  test("[REQ-098] a program that never ends is stopped with a message", () => {
    const { run } = lab();
    const r = run("srv-a2", "awk 'BEGIN { while (1) { } }'");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("너무 오래 걸려요");
  });

  test("[REQ-098] substr rounds its positions the way POSIX does, not the way mawk does", () => {
    const { sh } = lab();
    expect(
      sh(
        'awk \'BEGIN { print substr("hello", 1.5, 2) "|" substr("hello", 0, 2) "|" substr("hello", -1) }\'',
      ),
    ).toBe("el|h|hello");
  });

  test("[REQ-098] rand is the same sequence for the same seed, and srand returns the seed before", () => {
    const { sh } = lab();
    expect(
      sh(
        "awk 'BEGIN { srand(3); a = rand(); srand(3); b = rand(); print (a == b), (a >= 0 && a < 1), srand(4) }'",
      ),
    ).toBe("1 1 3");
  });
});

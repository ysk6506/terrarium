/**
 * The built-in functions of awk and the loops over an array (REQ-098): a piece of a string with a start before the first
 * character, a place of one string in another, case, the arithmetic ones, a random series that repeats under the same seed,
 * a loop over keys that is left early or skips one, and a function nobody defined.
 */
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const awk = (program: string): string => {
  const { sh } = lab();
  return sh(`awk '${program}' 2>&1`);
};

describe("awk built-in functions [REQ-098]", () => {
  test("[REQ-098] substr counts from one, keeps what is inside the string, and takes the rest when no length is given", () => {
    expect(awk('BEGIN{print substr("hello",2)}')).toBe("ello");
    expect(awk('BEGIN{print substr("hello",0,3)}')).toBe("he");
    expect(awk('BEGIN{print substr("hello",-1,4)}')).toBe("he");
    expect(awk('BEGIN{print substr("hello",4,10)}')).toBe("lo");
  });

  test("[REQ-098] index gives the place of one string in another, counting from one, and zero when it is not there", () => {
    expect(awk('BEGIN{print index("hello","ll"), index("hello","z")}')).toBe("3 0");
  });

  test("[REQ-098] case is changed whole, and the arithmetic ones give what mathematics gives", () => {
    expect(awk('BEGIN{print toupper("abC"), tolower("ABc")}')).toBe("ABC abc");
    expect(awk("BEGIN{print int(3.9), int(-3.9), sqrt(16), exp(0), log(1), sin(0), cos(0)}")).toBe(
      "3 -3 4 1 0 0 1",
    );
    expect(awk("BEGIN{print atan2(0,-1)}")).toBe("3.14159");
  });

  test("[REQ-098] the same seed gives the same first number, and srand gives back the seed before", () => {
    expect(awk("BEGIN{srand(5); a=rand(); srand(5); b=rand(); print (a==b), (a<1)}")).toBe("1 1");
    expect(awk("BEGIN{srand(1); print srand(7)}")).toBe("1");
  });

  test("[REQ-098] a function nobody defined is said so", () => {
    expect(awk("BEGIN{print nosuch(1)}")).toBe("awk: function nosuch never defined");
  });
});

describe("awk loops over the keys of an array [REQ-098]", () => {
  test("[REQ-098] a loop left with break stops there, and one that continues skips only the rest of that turn", () => {
    expect(awk("BEGIN{a[1];a[2];a[3]; for(k in a){n++; if(n==2) break}; print n}")).toBe("2");
    expect(awk("BEGIN{a[1];a[2];a[3]; for(k in a){n++; if(n==1) continue; m++}; print n, m}")).toBe(
      "3 2",
    );
  });

  test("[REQ-098] exit inside the loop ends it, and the END rule still runs", () => {
    expect(awk('BEGIN{a[1];a[2]; for(k in a){exit 4}}; END{print "end"}')).toBe("end");
  });
});

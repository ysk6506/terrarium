import { describe, expect, it } from "vitest";
import {
  DROP_AFTER_S,
  MAX_LEVEL,
  peopleKept,
  RISE_AFTER_MAX_S,
  RISE_AFTER_S,
  SLOW_FRAME_S,
  Strain,
  shownAt,
  spinsAt,
  stepAt,
} from "./strain";

const LATE = SLOW_FRAME_S * 3;
const FINE = 1 / 60;

/** Feed `seconds` of frames of one length. */
function run(strain: Strain, seconds: number, dt: number): void {
  for (let t = 0; t < seconds; t += dt) strain.frame(dt);
}

describe("a struggling machine gets less, never nothing [REQ-036]", () => {
  it("starts at ease, and a few late frames do not move it", () => {
    const s = new Strain();
    expect(s.level).toBe(0);
    for (let i = 0; i < 4; i++) s.frame(LATE);
    expect(s.level).toBe(0);
  });

  it("goes down one level each time late frames add up, and stops at the last level", () => {
    const s = new Strain();
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) {
      s.frame(LATE);
      if (seen.at(-1) !== s.level) seen.push(s.level);
    }
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(s.level).toBe(MAX_LEVEL);
  });

  it("a level costs about a second of late frames", () => {
    const s = new Strain();
    run(s, DROP_AFTER_S + LATE, LATE);
    expect(s.level).toBe(1);
  });

  it("fine frames earn a level back only after a good while, one level at a time", () => {
    const s = new Strain();
    run(s, 30, LATE);
    expect(s.level).toBe(MAX_LEVEL);
    run(s, RISE_AFTER_S - 1, FINE);
    expect(s.level).toBe(MAX_LEVEL);
    run(s, 2, FINE);
    expect(s.level).toBe(MAX_LEVEL - 1);
    run(s, RISE_AFTER_S + 1, FINE);
    expect(s.level).toBe(MAX_LEVEL - 2);
  });

  it("a late frame in the middle of the wait starts the wait again", () => {
    const s = new Strain();
    run(s, 30, LATE);
    for (let i = 0; i < 4; i++) {
      run(s, RISE_AFTER_S - 1, FINE);
      s.frame(LATE);
    }
    expect(s.level).toBe(MAX_LEVEL);
  });

  it("a machine that is late now and then, under a fifth of the time, stays where it is", () => {
    const s = new Strain();
    for (let round = 0; round < 200; round++) {
      s.frame(LATE);
      run(s, LATE * 6, FINE);
    }
    expect(s.level).toBe(0);
  });

  it("a machine that cannot hold a level waits longer each time before trying it again", () => {
    const s = new Strain();
    let waits: number[] = [];
    let level = 0;
    for (let cycle = 0; cycle < 6; cycle++) {
      let up = 0;
      // Struggle, then ease: the level comes back after a wait that grows.
      run(s, 5, LATE);
      level = s.level;
      while (s.level >= level && up < 200) {
        run(s, 0.5, FINE);
        up += 0.5;
      }
      waits = [...waits, up];
      if (s.level === 0) break;
    }
    expect(Math.max(...waits)).toBeGreaterThan(RISE_AFTER_S);
    expect(Math.max(...waits)).toBeLessThanOrEqual(RISE_AFTER_MAX_S + 1);
  });

  it("starts over when reset", () => {
    const s = new Strain();
    run(s, 30, LATE);
    s.reset();
    expect(s.level).toBe(0);
    run(s, DROP_AFTER_S - 0.3, LATE);
    expect(s.level).toBe(0);
  });
});

describe("what a level shows [REQ-036]", () => {
  it("half for each level, 600 -> 300 -> 150 -> 75", () => {
    expect([0, 1, 2, 3].map((l) => shownAt(600, l))).toEqual([600, 300, 150, 75]);
  });

  it("an odd number rounds up, and there is never none while there is some", () => {
    expect([0, 1, 2, 3].map((l) => shownAt(5, l))).toEqual([5, 3, 2, 1]);
    expect([0, 1, 2, 3].map((l) => shownAt(1, l))).toEqual([1, 1, 1, 1]);
    expect(shownAt(0, 3)).toBe(0);
  });

  it("the steps get longer with the level but never stop", () => {
    const steps = [0, 1, 2, 3].map((l) => stepAt(0.05, l));
    expect(steps[0]).toBeCloseTo(0.05);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1] as number);
    expect(steps[3]).toBeLessThan(1);
    expect(stepAt(0.05, 99)).toBe(steps[3]);
    expect(stepAt(0.05, -1)).toBe(steps[0]);
  });

  it("the slow turn of the camera waits from the second level on", () => {
    expect([0, 1, 2, 3].map(spinsAt)).toEqual([true, true, false, false]);
  });
});

describe("the people who stay when there are fewer [REQ-036]", () => {
  const people = [
    { id: 0, role: "manager" },
    { id: 1, role: "engineer" },
    { id: 2, role: "engineer" },
    { id: 3, role: "technician" },
  ];

  it("everyone is there at ease", () => {
    expect([...peopleKept(people, 0)].sort()).toEqual([0, 1, 2, 3]);
  });

  it("walkers stay first, then the technician, the manager last", () => {
    expect([...peopleKept(people, 1)].sort()).toEqual([1, 2]);
    expect([...peopleKept(people, 2)]).toEqual([1]);
    expect([...peopleKept(people, 3)]).toEqual([1]);
  });

  it("one person at least is kept, and a room with only a manager keeps the manager", () => {
    expect([...peopleKept([{ id: 7, role: "manager" }], 3)]).toEqual([7]);
    expect(peopleKept([], 3).size).toBe(0);
  });

  it("roles it does not know come last", () => {
    expect([
      ...peopleKept(
        [
          { id: 0, role: "guest" },
          { id: 1, role: "manager" },
        ],
        1,
      ),
    ]).toEqual([1]);
  });
});

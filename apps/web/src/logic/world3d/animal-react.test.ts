import { describe, expect, test } from "vitest";
import {
  BIRD_LAND_M,
  BIRD_RISE_M,
  BIRD_TIMES,
  CAT_TIMES,
  CAT_WALK_M,
  cuesOf,
  reactionOf,
  SAY_S,
  totalOf,
  walkDir,
} from "./animal-react";
import { envelopeOf, gainAt, lengthOf, notesOf } from "./animal-sound";
import type { CampusPlan } from "./campus-plan-types";

const at = (t: number) => reactionOf("cat", t, false);

describe("고양이 반응: 기지개 → 야옹 → 걷기 → 앉기 → 돌아오기 [REQ-105]", () => {
  test("단계는 정해진 시간 순서로 바뀐다", () => {
    const { stretch, meow, walk, sit } = CAT_TIMES;
    expect(at(0.1).phase).toBe("stretch");
    expect(at(stretch + 0.1).phase).toBe("meow");
    expect(at(stretch + meow + 0.1).phase).toBe("walk");
    expect(at(stretch + meow + walk + 0.1).phase).toBe("sit");
    expect(at(stretch + meow + walk + sit + 0.1).phase).toBe("return");
    const total = totalOf("cat", false);
    expect(total).toBeCloseTo(9.6);
    expect(at(total + 0.01).done).toBe(true);
    expect(at(total - 0.1).done).toBe(false);
  });

  test("기지개에서 앞이 숙고 꼬리가 흔들리며, 몇 미터 걷고 앉았다가 제자리로 돌아온다", () => {
    expect(at(0.6).pitch).toBeGreaterThan(0.3);
    expect(Math.abs(at(0.5).tail) + Math.abs(at(0.7).tail)).toBeGreaterThan(0.2);
    const sat = at(CAT_TIMES.stretch + CAT_TIMES.meow + CAT_TIMES.walk + 1.5);
    expect(sat.forward).toBeCloseTo(CAT_WALK_M);
    expect(sat.sit).toBe(1);
    expect(at(0).forward).toBe(0);
    expect(at(totalOf("cat", false) - 0.001).forward).toBeCloseTo(0, 1);
  });

  test("끊김 없이 이어진다: 0.05초 사이에 반 미터 넘게 움직이지 않는다", () => {
    for (let t = 0; t < 9.6; t += 0.05) {
      const a = at(t);
      const b = at(t + 0.05);
      expect(Math.hypot(a.forward - b.forward, a.side - b.side, a.y - b.y)).toBeLessThan(0.5);
    }
  });

  test("야옹은 스트레칭 뒤에 나오고, 글은 2초 뜬다", () => {
    const c = cuesOf("cat", false);
    expect(c.soundAt).toBe(CAT_TIMES.stretch);
    expect(c.text).toBe("야옹");
    expect(c.textFor).toBe(SAY_S);
    expect(SAY_S).toBe(2);
  });
});

describe("새 반응: 3 m 날아올라 한 바퀴 돌고 가까이 앉는다 [REQ-105]", () => {
  const bird = (t: number) => reactionOf("bird", t, false);
  test("올라가고, 한 바퀴 돌아 제자리를 지나고, 2 m 안에 내려앉는다", () => {
    expect(bird(BIRD_TIMES.flap).y).toBeCloseTo(BIRD_RISE_M, 1);
    expect(bird(0.5).phase).toBe("flap");
    const c0 = bird(BIRD_TIMES.flap);
    const c1 = bird(BIRD_TIMES.flap + BIRD_TIMES.circle - 0.001);
    expect(Math.hypot(c1.forward - c0.forward, c1.side - c0.side)).toBeLessThan(0.1);
    const mid = bird(BIRD_TIMES.flap + BIRD_TIMES.circle / 2);
    expect(Math.hypot(mid.forward, mid.side)).toBeGreaterThan(4);
    const end = bird(totalOf("bird", false) + 0.1);
    expect(end.done).toBe(true);
    expect(end.y).toBe(0);
    expect(end.forward).toBe(BIRD_LAND_M);
    expect(cuesOf("bird", false)).toMatchObject({ soundAt: 0, text: "짹" });
  });
});

describe("움직임 줄이기: 움직임 없이 소리와 글만 [REQ-105]", () => {
  test("어느 때든 가만히 있고 곧바로 끝난 것으로 읽힌다", () => {
    for (const kind of ["cat", "bird"] as const) {
      expect(totalOf(kind, true)).toBe(0);
      for (const t of [0, 0.5, 2, 5]) {
        const f = reactionOf(kind, t, true);
        expect(f).toMatchObject({ forward: 0, y: 0, pitch: 0, tail: 0, flap: 0, done: true });
      }
      const cue = cuesOf(kind, true);
      expect(cue.soundAt).toBe(0);
      expect(cue.textFor).toBe(2);
    }
  });
});

describe("소리 만들기: 오디오 장치 없이 값만 [REQ-105]", () => {
  test("야옹은 600→400 Hz 근처 쓸어내림 둘, 합쳐 0.5초", () => {
    const meow = notesOf("cat");
    expect(meow).toHaveLength(2);
    expect(lengthOf(meow)).toBeCloseTo(0.5);
    for (const n of meow) {
      expect(n.from).toBeGreaterThanOrEqual(540);
      expect(n.from).toBeLessThanOrEqual(620);
      expect(n.to).toBeGreaterThanOrEqual(380);
      expect(n.to).toBeLessThanOrEqual(440);
      expect(["sine", "triangle"]).toContain(n.wave);
      expect(n.peak).toBeLessThan(0.25);
    }
  });

  test("짹은 1.6 kHz 짧은 소리 둘", () => {
    const chirp = notesOf("bird");
    expect(chirp.map((n) => n.from)).toEqual([1600, 1600]);
    expect(chirp.every((n) => n.dur <= 0.1)).toBe(true);
    expect(lengthOf(chirp)).toBeLessThan(0.3);
  });

  test("소리는 조용히 시작해 부드럽게 올라갔다 0으로 끝난다", () => {
    for (const n of [...notesOf("cat"), ...notesOf("bird")]) {
      const env = envelopeOf(n);
      expect(env[0]?.v).toBe(0);
      expect(env.at(-1)?.v).toBe(0);
      expect(env.at(-1)?.t).toBeCloseTo(n.dur);
      expect(Math.max(...env.map((p) => p.v))).toBe(n.peak);
      expect(gainAt(n, n.attack / 2)).toBeGreaterThan(0);
      expect(gainAt(n, n.attack / 2)).toBeLessThan(n.peak);
      expect(gainAt(n, (n.attack + n.dur - n.release) / 2)).toBe(n.peak);
      expect(gainAt(n, n.dur + 1)).toBe(0);
    }
  });
});

describe("걸을 방향 [REQ-105]", () => {
  const plan = {
    roads: [{ kind: "road", area: { x0: -50, x1: 50, z0: 1, z1: 7 } }],
    parking: [],
    clearZones: [],
    trees: [],
  } as unknown as CampusPlan;
  test("앞이 길이면 옆으로, 사방이 막히면 없다", () => {
    const dir = walkDir(plan, { x: 0, z: -1 }, 0, 3);
    expect(dir).toBeDefined();
    expect(dir).not.toBe(0);
    const boxed = {
      ...plan,
      roads: [{ kind: "road", area: { x0: -10, x1: 10, z0: -10, z1: 10 } }],
    } as unknown as CampusPlan;
    expect(walkDir(boxed, { x: 0, z: 0 }, 0, 3)).toBeUndefined();
  });
});

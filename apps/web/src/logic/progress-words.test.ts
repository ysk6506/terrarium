import { describe, expect, test } from "vitest";
import { progressWords } from ".";

const progress = (total: number, completed: number, finished = total, running = 0) => ({
  total,
  finished,
  completed,
  passed: 0,
  failed: 0,
  cancelled: 0,
  running,
});

describe("how far an experiment got reads as stopped when a person stopped it [REQ-030]", () => {
  test("a stopped experiment says what it planned beside what ended", () => {
    expect(progressWords("cancelled", progress(20, 1))).toBe("20번 중 1번 끝");
    expect(progressWords("cancelled", progress(3, 0))).toBe("3번 중 0번 끝");
  });

  test("the other states say it as before", () => {
    expect(progressWords("completed", progress(5, 5))).toBe("5번 끝");
    expect(progressWords("running", progress(20, 3, 3, 2))).toBe("3/20번, 2번 실행 중");
    expect(progressWords("queued", progress(4, 0, 0))).toBe("0/4번");
  });
});

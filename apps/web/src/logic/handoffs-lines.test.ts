import type { HandoffReport, HandoffRow } from "@terrarium/core/oracle";
import { describe, expect, test } from "vitest";
import { handoffSummary, measureLines, scopeText } from "./handoffs";

const fault = (needless = false) => ({
  faultId: "f1",
  faultType: "cooling_unit_failure",
  target: "crah-1",
  etaSeconds: 3600,
  doneAt: 3600,
  finished: true,
  needless,
});

const row = (over: Partial<HandoffRow> = {}): HandoffRow => ({
  id: "h1",
  domain: "service_os",
  team: "시설팀",
  at: 0,
  doneAt: 3600,
  faults: [fault()],
  bridge: { impaired: 0, acted: false },
  cleanup: { needed: 0, done: 0 },
  meanwhile: { alarms: 0, looked: 0, calls: 4 },
  ...over,
});

const lines = (r: HandoffRow) =>
  measureLines({ count: 1, faults: 1, needless: 0, penalty: 0, rows: [r] })[0]?.lines ?? [];
const find = (r: HandoffRow, label: string) => lines(r).find((l) => l.label === label);

describe("each hand-off is measured by four lines that say what happened [REQ-093]", () => {
  test("the temporary measure says whether the services were saved, kept down or never at risk", () => {
    expect(find(row(), "임시 조치")).toEqual({
      label: "임시 조치",
      value: "넘길 때 멈춘 서비스가 없었어요",
      tone: "plain",
    });
    const saved = find(
      row({ bridge: { impaired: 2, acted: true, savedAfterSeconds: 600 } }),
      "임시 조치",
    );
    expect(saved?.tone).toBe("good");
    expect(saved?.value).toContain("살렸어요");
    expect(saved?.value).toContain("1시간 뒤에 끝냈어요");
    const acted = find(row({ bridge: { impaired: 2, acted: true } }), "임시 조치");
    expect(acted?.tone).toBe("bad");
    expect(acted?.value).toContain("조치는 했지만");
    const waited = find(row({ bridge: { impaired: 2, acted: false } }), "임시 조치");
    expect(waited?.tone).toBe("bad");
    expect(waited?.value).toContain("기다리기만 했어요");
  });

  test("the clean-up says whether the temporary moves were all put back, partly, or not at all", () => {
    expect(find(row(), "마무리")?.tone).toBe("plain");
    expect(find(row({ cleanup: { needed: 3, done: 0 } }), "마무리")).toMatchObject({
      tone: "bad",
      value: "임시 조치 3건을 되돌리지 않았어요",
    });
    expect(
      find(row({ cleanup: { needed: 3, done: 3, lateSeconds: 120 } }), "마무리"),
    ).toMatchObject({
      tone: "good",
      value: "임시 조치 3건을 모두 되돌렸어요 (끝난 지 2분 뒤)",
    });
    expect(find(row({ cleanup: { needed: 3, done: 1 } }), "마무리")).toMatchObject({
      tone: "bad",
      value: "임시 조치 3건 중 1건만 되돌렸어요",
    });
  });

  test("the work done meanwhile says how many of the new alarms the agent looked at", () => {
    expect(find(row(), "동시 작업")).toMatchObject({ tone: "plain" });
    expect(find(row(), "동시 작업")?.value).toContain("툴 호출 4번");
    expect(find(row({ meanwhile: { alarms: 3, looked: 3, calls: 9 } }), "동시 작업")).toMatchObject(
      {
        tone: "good",
        value: "새 알람 3개 중 3개를 살펴봤어요",
      },
    );
    expect(find(row({ meanwhile: { alarms: 3, looked: 1, calls: 9 } }), "동시 작업")?.tone).toBe(
      "bad",
    );
  });

  test("the reason for handing over is good only when every fault was outside the agent's own domain", () => {
    expect(find(row(), "넘긴 근거")).toMatchObject({ tone: "good" });
    expect(find(row({ faults: [fault(true), fault(false)] }), "넘긴 근거")).toMatchObject({
      tone: "bad",
      value: "1건은 내 도메인 툴로 풀 수 있는 고장이었어요",
    });
    expect(find(row({ faults: [] }), "넘긴 근거")).toMatchObject({
      tone: "bad",
      value: "그 도메인에 고장이 없는데 넘겼어요",
    });
  });
});

describe("the scope and the summary of the hand-offs read as one sentence [REQ-093]", () => {
  test("the scope names the agent's domains, or says all of them when none is set", () => {
    expect(scopeText({ domains: [], leadTimesLabel: "기본값" })).toBe(
      "내 도메인 모든 도메인 · 담당자 설정 기본값",
    );
    expect(
      scopeText({ domains: ["service_os", "virtualization"], leadTimesLabel: "빠르게" }),
    ).toMatch(/^내 도메인 .+, .+ · 담당자 설정 빠르게$/);
  });

  test("the summary adds the points lost only when some hand-offs were needless", () => {
    const report = (penalty: number, needless: number): HandoffReport => ({
      count: 2,
      faults: 3,
      needless,
      penalty,
      rows: [],
    });
    expect(handoffSummary(report(0, 0))).toBe("2번 넘겼어요 · 고장 3개");
    expect(handoffSummary(report(5, 1))).toBe(
      "2번 넘겼어요 · 고장 3개 · 내 도메인에서 풀 수 있는 1건 때문에 −5점",
    );
  });
});

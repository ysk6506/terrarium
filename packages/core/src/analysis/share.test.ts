import { describe, expect, test } from "vitest";
import {
  analyzeExperiment,
  DIAGNOSIS_SCHEMA,
  diagnosisRecords,
  errorPattern,
  escapeHtml,
  faultTypeStats,
  fromJsonl,
  modelingBrief,
  renderHtml,
  renderMarkdown,
  renderText,
  sparkline,
  toJsonl,
  toolErrorStats,
} from ".";
import { experimentOf, play, SCRIPTS } from "./test-support/runs";

const mixed = () =>
  experimentOf({ id: "e1", runs: [SCRIPTS.good, SCRIPTS.wrong, SCRIPTS.partial, "fail"] });

describe("sharing results as text, Markdown and HTML [REQ-038]", () => {
  test("text to paste: what ran, the key numbers, findings and the link", () => {
    const text = renderText(analyzeExperiment(mixed()), {
      url: "https://terrarium.example/e/e1",
      names: { "h-plain": "기본 하네스" },
    });
    const lines = text.split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "[테라리움] 실험 e1",
      "샘플 세계 · cooling-failure",
      `하네스 기본 하네스 · 에이전트 triage · 툴 ${mixed().experiment.recipe.tools.length}개 · 실행 4번`,
      expect.stringMatching(/^합격 1\/3 \(33%\) · 평균 57\.0점 \(±\d+\.\d\)$/),
      expect.stringMatching(/^진단 정확도 33% · 진단까지 .+ · 툴 호출 /),
    ]);
    expect(text).toContain("- 3번 중 1번 합격 (33%)");
    expect(lines.at(-1)).toBe("https://terrarium.example/e/e1");
  });

  test("Markdown: tables survive names and summaries with pipes in them", () => {
    const md = renderMarkdown(analyzeExperiment(mixed()), {
      url: "https://terrarium.example/e/e1",
    });
    expect(md.startsWith("# 실험 e1\n")).toBe(true);
    expect(md).toContain("## 채점 항목");
    expect(md).toContain("| # | 상황 | 상태 | 점수 | 판정 | 종료 | 진단 | 툴 호출 | 진단까지 |");
    const rows = md.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("| 90.9 | 합격 | 진단 제출 | 정답 |");
    expect(rows[1]).toContain("| 오답 |");
    expect(rows[3]).toContain("| 실패 | — | 불합격 | — | 미제출 |");
    expect(md.trimEnd().endsWith("[테라리움에서 보기](https://terrarium.example/e/e1)")).toBe(true);
  });

  test("HTML: one self-contained page, light and dark, with everything outside escaped", () => {
    const input = mixed();
    const html = renderHtml(analyzeExperiment(input), {
      url: "https://terrarium.example/e/e1?a=1&b=2",
      generatedAt: "2026-10-29 10:00",
      series: { label: "실행 1의 주요 지표", series: input.runs[0]?.result?.series ?? [] },
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain("prefers-color-scheme:dark");
    // No scripts, no external files: it opens the same anywhere, even offline.
    expect(html).not.toMatch(/<script|<link|src=|@import|url\(/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; 팬 고장 | 확인 필요");
    expect(html).toContain('href="https://terrarium.example/e/e1?a=1&amp;b=2"');
    expect(html.match(/<rect class="(pass|fail)"/g)).toHaveLength(4);
    expect(html).toContain("합격선 60");
    expect(html).toContain("<h2>실행 1의 주요 지표</h2>");
    expect(html).toContain("crah-1 · 급기 온도(°C)");
    expect(html).toContain('<svg class="spark"');
    expect(html).toContain("2026-10-29 10:00");
  });

  test("an experiment with nothing finished still renders, without empty sections", () => {
    const a = analyzeExperiment(experimentOf({ id: "e2", runs: ["cancel"] }));
    const html = renderHtml(a);
    expect(html).not.toContain("<h2>발견</h2>");
    expect(html).not.toContain("<h2>채점 항목</h2>");
    expect(html).not.toContain('<svg class="spark"');
    expect(renderText(a)).not.toContain("\n\n");
    expect(renderMarkdown(a)).not.toContain("## 발견");
  });

  test("helpers: escaping and sparklines", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
    expect(sparkline([[0, 1]])).toBe("");
    expect(
      sparkline([
        [0, 20],
        [30, 25],
        [60, 30],
      ]),
    ).toContain('<path d="M0.0 36.0L100.0 20.0L200.0 4.0"/>');
    // A flat line stays inside the box.
    expect(
      sparkline([
        [0, 5],
        [10, 5],
      ]),
    ).toContain('d="M0.0 36.0L200.0 36.0"');
  });
});

describe("diagnosis records and the modelling brief [REQ-015]", () => {
  test("one record per completed run: the truth, the answer, and how it got there", () => {
    const { experiment, runs } = mixed();
    const records = diagnosisRecords(experiment, runs);
    expect(records).toHaveLength(3);
    const [good, wrong] = records;
    expect(good).toMatchObject({
      schema: DIAGNOSIS_SCHEMA,
      experimentId: "e1",
      runId: "e1-r0",
      harnessId: "h-plain",
      agentId: "triage",
      truth: { rootCause: ["crah-1"], faultType: ["cooling_unit_failure"] },
      submitted: { rootCause: "crah-1", faultType: "cooling_unit_failure" },
      correct: { root: true, type: true },
      afterSeconds: 60,
      score: 90.9,
      passed: true,
      endReason: "diagnosed",
      calls: { total: 3, investigation: 2, failed: 0 },
      toolErrors: [],
      finishedAt: "2026-10-29T00:00:00.000Z",
    });
    expect(good?.world.digest).toBe(experiment.snapshot.worldDigest);
    expect(wrong).toMatchObject({ correct: { root: false, type: false }, calls: { failed: 2 } });
    expect(wrong?.toolErrors.map((e) => e.tool)).toEqual(["get_entity", "get_entity"]);
  });

  test("JSON Lines round-trip, and other files are refused with the line that is wrong", () => {
    const { experiment, runs } = mixed();
    const records = diagnosisRecords(experiment, runs);
    const jsonl = toJsonl(records);
    expect(jsonl.split("\n")).toHaveLength(4); // three lines and the final newline
    expect(fromJsonl(jsonl)).toEqual(records);
    expect(toJsonl([])).toBe("");
    expect(fromJsonl("\n\n")).toEqual([]);
    expect(() => fromJsonl(`${jsonl}{"schema":"other"}\n`)).toThrow("4번째 줄은 진단 기록");
  });

  test("a run without a diagnosis expectation has no truth to compare", () => {
    const { experiment, runs } = experimentOf({
      id: "e3",
      runs: [SCRIPTS.silent],
      templateId: "vm-cpu-spike-escalation",
    });
    const [r] = diagnosisRecords(experiment, runs);
    expect(r?.submitted).toBeNull();
    expect(r?.afterSeconds).toBeNull();
    const stats = faultTypeStats([{ ...(r as NonNullable<typeof r>), truth: null, correct: null }]);
    expect(stats).toEqual([]);
  });

  test("fault types are ranked by how often agents get them wrong, with what they confused them with", () => {
    const a = experimentOf({ id: "a", runs: [SCRIPTS.good, SCRIPTS.wrong, SCRIPTS.partial] });
    const b = experimentOf({ id: "b", agentId: "deep", runs: [SCRIPTS.wrong, SCRIPTS.partial] });
    const records = [
      ...diagnosisRecords(a.experiment, a.runs),
      ...diagnosisRecords(b.experiment, b.runs),
    ];
    expect(faultTypeStats(records)).toEqual([
      {
        faultType: "cooling_unit_failure",
        runs: 5,
        agents: 2,
        rootRate: 0.6,
        typeRate: 0.2,
        confusedWith: [
          { faultType: "breaker_trip", count: 2 },
          { faultType: "fan_failure", count: 2 },
        ],
      },
    ]);
  });

  test("tool errors group by the shape of the message, not the ids in it", () => {
    expect(errorPattern("no entity 'srv-zz-9'")).toBe(errorPattern("no entity 'srv-zz-10'"));
    expect(errorPattern("seconds must be at most 3600, got 7200")).toBe(
      "seconds must be at most #, got #",
    );
    expect(errorPattern("unknown rack rack-a-12")).toBe("unknown rack #id");
    const { experiment, runs } = mixed();
    const stats = toolErrorStats(diagnosisRecords(experiment, runs));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ tool: "get_entity", count: 2 });
    expect(stats[0]?.example).toContain("srv-zz-9");
  });

  test("the brief hands the simulator developer where the world is thin", () => {
    const a = experimentOf({ id: "a", runs: [SCRIPTS.wrong, SCRIPTS.partial] });
    const b = experimentOf({ id: "b", agentId: "deep", runs: [SCRIPTS.wrong, SCRIPTS.wrong] });
    const records = [
      ...diagnosisRecords(a.experiment, a.runs),
      ...diagnosisRecords(b.experiment, b.runs),
    ];
    const brief = modelingBrief({
      records,
      generatedAt: "2026-10-29",
      worlds: [
        {
          worldId: "w-kg",
          worldName: "평택 P2 가져오기",
          unknownLabels: { Chiller: 4 },
          unknownRelationships: { FEEDS_WATER: 9 },
          assumptions: ["랙 높이를 42U로 가정했어요"],
        },
      ],
    });
    expect(brief.startsWith("# 시뮬레이터 모델링 브리프\n")).toBe(true);
    expect(brief).toContain("- 실행 4번 (진단 요구 4번), 실험 2개, 에이전트 2종");
    expect(brief).toContain(
      "| cooling_unit_failure | 4 | 2 | 25% | 0% | fan_failure (3), breaker_trip (1) |",
    );
    expect(brief).toContain("'cooling_unit_failure'는 에이전트 2종에 걸쳐 정답률이 0%에 그쳐요");
    expect(brief).toContain("툴 `get_entity`가 같은 오류를 6번 냈어요");
    expect(brief).toContain("### 평택 P2 가져오기 (`w-kg`)");
    expect(brief).toContain("- 매핑하지 못한 라벨·링크: Chiller 4개, FEEDS_WATER 9개");
    expect(brief).toContain("- 가정: 랙 높이를 42U로 가정했어요");
    expect(brief).toContain(
      "'평택 P2 가져오기'를 가져올 때 매핑하지 못한 것: Chiller, FEEDS_WATER",
    );
  });

  test("an empty record set still gives a readable brief; easy faults are flagged too", () => {
    const empty = modelingBrief({ records: [] });
    expect(empty).toContain("진단을 요구한 실행이 아직 없어요.");
    expect(empty).toContain("툴 오류가 없었어요.");
    expect(empty).toContain("- 지금 기록으로는 특별히 손볼 곳이 보이지 않아요.");
    expect(empty).not.toContain("가져온 세계의 빈틈");
    const easy = experimentOf({ id: "z", runs: Array.from({ length: 5 }, () => SCRIPTS.good) });
    const brief = modelingBrief({ records: diagnosisRecords(easy.experiment, easy.runs) });
    expect(brief).toContain("5번 모두 맞혔어요. 현실보다 단서가 너무 뚜렷하지 않은지 봐요.");
    expect(play(SCRIPTS.good).score.total).toBe(90.9);
  });
});

/**
 * Sharing results (REQ-038): plain text to paste into a chat, Markdown for a wiki or an issue, and a
 * self-contained HTML report (no scripts, no external files) that opens anywhere and prints well.
 * Everything that came from outside (names, the agent's own summary) is escaped.
 */

import { RUN_STATUS_LABELS } from "@terrarium/core/experiments";
import { formatDuration } from "@terrarium/core/kernel";
import { END_REASON_LABELS } from "@terrarium/core/oracle";
import type { MetricSeries } from "@terrarium/core/session";
import type { ExperimentAnalysis } from "./experiment";
import type { RunAnalysis } from "./run";
import type { Summary } from "./stats";

export interface RenderOptions {
  /** Link back to the experiment, when the report is shared from the server. */
  readonly url?: string;
  /** When the report was made (ISO); shown in the footer. */
  readonly generatedAt?: string;
  /** Display names for harness and agent ids. */
  readonly names?: Readonly<Record<string, string>>;
  /** Recorded series of one representative run, drawn as sparklines. */
  readonly series?: { readonly label: string; readonly series: readonly MetricSeries[] };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const name = (id: string, o: RenderOptions) => o.names?.[id] ?? id;
const mean = (s: Summary | undefined, unit = "", digits = 1) =>
  s ? `${s.mean.toFixed(digits)}${unit}${s.n > 1 ? ` (±${s.ci95.toFixed(digits)})` : ""}` : "—";

function headline(a: ExperimentAnalysis, o: RenderOptions): string[] {
  const e = a.experiment;
  const r = e.recipe;
  return [
    `${e.snapshot.worldName} · ${e.snapshot.scenarioName}`,
    `하네스 ${name(r.harnessId, o)} · 에이전트 ${name(r.agentId, o)} · 툴 ${r.tools.length}개 · 실행 ${a.progress.total}번`,
  ];
}

function keyNumbers(a: ExperimentAnalysis): string[] {
  const done = a.progress.completed;
  return [
    `합격 ${a.runs.filter((x) => x.passed).length}/${done} (${pct(a.passRate)}) · 평균 ${mean(a.score, "점")}`,
    `진단 정확도 ${pct(a.diagnosisRate)} · 진단까지 ${a.timeToDiagnosis ? formatDuration(a.timeToDiagnosis.mean) : "—"} · 툴 호출 ${mean(a.calls, "회")}`,
  ];
}

export function renderText(a: ExperimentAnalysis, o: RenderOptions = {}): string {
  const lines = [`[테라리움] ${a.experiment.name}`, ...headline(a, o), ...keyNumbers(a)];
  if (a.findings.length > 0) lines.push("", ...a.findings.map((f) => `- ${f}`));
  if (o.url) lines.push("", o.url);
  return lines.join("\n");
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function runRow(r: RunAnalysis): string[] {
  return [
    String(r.index + 1),
    String(r.seed),
    RUN_STATUS_LABELS[r.status],
    r.score === null ? "—" : r.score.toFixed(1),
    r.passed ? "합격" : "불합격",
    r.endReason ? END_REASON_LABELS[r.endReason] : "—",
    r.diagnosis.root && r.diagnosis.type ? "정답" : r.diagnosis.submitted ? "오답" : "미제출",
    String(r.efficiency.investigationCalls),
    r.diagnosis.afterSeconds === undefined ? "—" : formatDuration(r.diagnosis.afterSeconds),
  ];
}

const RUN_HEADERS = ["#", "시드", "상태", "점수", "판정", "종료", "진단", "툴 호출", "진단까지"];

export function renderMarkdown(a: ExperimentAnalysis, o: RenderOptions = {}): string {
  const out = [
    `# ${a.experiment.name}`,
    "",
    ...headline(a, o).map((l) => `${l}  `),
    "",
    ...keyNumbers(a).map((l) => `**${l}**  `),
    "",
  ];
  if (a.findings.length > 0) out.push("## 발견", "", ...a.findings.map((f) => `- ${f}`), "");
  if (a.criteria.length > 0) {
    out.push("## 채점 항목", "", "| 항목 | 달성률 | 평균 점수 |", "|---|---|---|");
    for (const c of a.criteria)
      out.push(
        `| ${cell(c.label)} | ${pct(c.rate)} | ${c.meanPoints}${c.max > 0 ? ` / ${c.max}` : ""} |`,
      );
    out.push("");
  }
  out.push(
    "## 실행",
    "",
    `| ${RUN_HEADERS.join(" | ")} |`,
    `|${RUN_HEADERS.map(() => "---").join("|")}|`,
  );
  for (const r of a.runs) out.push(`| ${runRow(r).map(cell).join(" | ")} |`);
  if (o.url) out.push("", `[테라리움에서 보기](${o.url})`);
  return `${out.join("\n")}\n`;
}

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Bars of each run's score with the pass mark, as inline SVG. */
function scoreChart(runs: readonly RunAnalysis[]): string {
  const w = Math.max(240, runs.length * 36);
  const bars = runs
    .map((r, i) => {
      const v = r.score ?? 0;
      const h = (v / 100) * 120;
      const cls = r.passed ? "pass" : "fail";
      return `<rect class="${cls}" x="${i * 36 + 8}" y="${140 - h}" width="24" height="${h}"><title>실행 ${i + 1}: ${v.toFixed(1)}점</title></rect><text x="${i * 36 + 20}" y="156" text-anchor="middle">${i + 1}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${w} 160" role="img" aria-label="실행별 점수"><line class="mark" x1="0" x2="${w}" y1="${140 - 72}" y2="${140 - 72}"/><text class="mark-label" x="${w - 4}" y="${140 - 76}" text-anchor="end">합격선 60</text>${bars}</svg>`;
}

const METRIC_LABELS: Readonly<Record<string, string>> = {
  inletC: "흡기 온도(°C)",
  outletC: "배기 온도(°C)",
  cpuC: "CPU 온도(°C)",
  cpuUtil: "CPU 사용률",
  cpuUsage: "CPU 사용률",
  powerW: "전력(W)",
  loadW: "부하(W)",
  loadA: "부하(A)",
  loadKw: "냉방 부하(kW)",
  supplyC: "급기 온도(°C)",
  returnC: "환기 온도(°C)",
  ambientC: "실내 온도(°C)",
  batteryPct: "배터리(%)",
  usedPct: "사용량(%)",
};

/** One small line chart: the shape over time matters here, not exact values. */
export function sparkline(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length < 2) return "";
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * 200;
  const sy = (y: number) => 36 - ((y - y0) / (y1 - y0 || 1)) * 32;
  const d = points
    .map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`)
    .join("");
  return `<svg class="spark" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

function seriesSection(o: RenderOptions): string {
  const list = (o.series?.series ?? []).filter((s) => s.points.length >= 2).slice(0, 12);
  if (list.length === 0) return "";
  const cards = list
    .map((s) => {
      const ys = s.points.map((p) => p[1]);
      const range = `${fmt(Math.min(...ys))} ~ ${fmt(Math.max(...ys))}`;
      return `<div class="tile"><span>${escapeHtml(s.entityId)} · ${escapeHtml(METRIC_LABELS[s.metric] ?? s.metric)}</span>${sparkline(s.points)}<span>${range}</span></div>`;
    })
    .join("");
  return `<h2>${escapeHtml(o.series?.label ?? "주요 지표")}</h2><div class="tiles">${cards}</div>`;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

const STYLE = `
:root{--bg:#fafaf7;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e4e2dc;--pass:#2f7d4f;--fail:#b4483c;--accent:#3d5a80}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eceae4;--muted:#a3a19a;--card:#1f1f1c;--line:#34332f;--pass:#5cb37f;--fail:#e07a6c;--accent:#8fb3e0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}
.sub{color:var(--muted);margin:0}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.tile b{display:block;font-size:22px}.tile span{color:var(--muted);font-size:13px}
.chart{width:100%;max-width:640px;height:auto}.chart .pass{fill:var(--pass)}.chart .fail{fill:var(--fail)}.chart text{fill:var(--muted);font-size:11px}
.chart .mark{stroke:var(--muted);stroke-dasharray:4 4}ul{padding-left:20px}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}th{color:var(--muted);font-weight:600}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden;min-width:80px}.bar i{display:block;height:100%;background:var(--accent)}
footer{color:var(--muted);font-size:13px;margin-top:32px}a{color:var(--accent)}
.scroll{overflow-x:auto}.spark{display:block;width:100%;height:40px;margin:6px 0}.spark path{fill:none;stroke:var(--accent);stroke-width:1.5;vector-effect:non-scaling-stroke}
@media print{.tile,table{break-inside:avoid}}`;

function tile(value: string, label: string): string {
  return `<div class="tile"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
}

export function renderHtml(a: ExperimentAnalysis, o: RenderOptions = {}): string {
  const tiles = [
    tile(
      pct(a.passRate),
      `합격률 (${a.runs.filter((r) => r.passed).length}/${a.progress.completed})`,
    ),
    tile(
      a.score ? `${a.score.mean.toFixed(1)}점` : "—",
      a.score && a.score.n > 1 ? `평균 점수 ±${a.score.ci95.toFixed(1)}` : "평균 점수",
    ),
    tile(pct(a.diagnosisRate), "진단 정확도"),
    tile(a.timeToDiagnosis ? formatDuration(a.timeToDiagnosis.mean) : "—", "진단까지 (시뮬레이션)"),
    tile(a.calls ? `${a.calls.mean.toFixed(1)}회` : "—", "툴 호출"),
  ].join("");
  const criteria = a.criteria
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.label)}</td><td><div class="bar"><i style="width:${Math.round(c.rate * 100)}%"></i></div></td><td>${pct(c.rate)}</td></tr>`,
    )
    .join("");
  const runs = a.runs
    .map(
      (r) =>
        `<tr>${runRow(r)
          .map((c) => `<td>${escapeHtml(c)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const findings = a.findings.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const summaries = a.runs
    .filter((r) => r.diagnosis.summary)
    .map((r) => `<li>실행 ${r.index + 1}: ${escapeHtml(r.diagnosis.summary as string)}</li>`)
    .join("");
  const [line1, line2] = headline(a, o).map(escapeHtml);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(a.experiment.name)} — 테라리움</title><style>${STYLE}</style></head>
<body><main>
<h1>${escapeHtml(a.experiment.name)}</h1><p class="sub">${line1}</p><p class="sub">${line2}</p>
<div class="tiles">${tiles}</div>
<h2>실행별 점수</h2>${scoreChart(a.runs)}
${findings ? `<h2>발견</h2><ul>${findings}</ul>` : ""}
${criteria ? `<h2>채점 항목</h2><table><tr><th>항목</th><th></th><th>달성률</th></tr>${criteria}</table>` : ""}
<h2>실행</h2><div class="scroll"><table><tr>${RUN_HEADERS.map((h) => `<th>${h}</th>`).join("")}</tr>${runs}</table></div>
${summaries ? `<h2>에이전트의 진단 요약</h2><ul>${summaries}</ul>` : ""}
${seriesSection(o)}
<footer>테라리움 실험 보고서${o.generatedAt ? ` · ${escapeHtml(o.generatedAt)}` : ""}${o.url ? ` · <a href="${escapeHtml(o.url)}">테라리움에서 보기</a>` : ""}</footer>
</main></body></html>
`;
}

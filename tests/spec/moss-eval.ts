/**
 * `pnpm moss-eval` (REQ-103, ADR-0124): 질문 은행을 실제 서버의 `POST /api/moss/ask`에 물어, 출처를 달고 답한 비율과
 * "문서에 없어요"로 답한 비율을 잰다. 기본 모델이 등록된 서버가 있어야 해요 (`TERRARIUM_URL`, 기본 http://127.0.0.1:8787).
 *
 *   pnpm moss-eval            손으로 쓴 "왜" 질문 전부 + 자동 질문 40개
 *   pnpm moss-eval --all      은행 전부
 *   pnpm moss-eval --record   결과를 harness/config/moss-floor.json 의 measured에 적는다 (바닥값 floor는 아직 정하지 않아요)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MossAnswerView } from "@terrarium/core/contract";
import { type BankQuestion, loadBank } from "./moss-bank";

const FLOOR_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "harness",
  "config",
  "moss-floor.json",
);
const AUTO_SAMPLE = 40;

const say = (line: string): void => void process.stdout.write(`${line}\n`);

export interface Tally {
  readonly asked: number;
  readonly withSources: number;
  readonly notInDocs: number;
  readonly failed: number;
  readonly foundExpected: number;
}

/** 은행에서 물을 질문: 손으로 쓴 것 전부, 자동 질문은 고르게 건너뛰며 표본(또는 전부). */
export function pick(bank: readonly BankQuestion[], all: boolean): BankQuestion[] {
  const why = bank.filter((q) => q.kind === "why");
  const auto = bank.filter((q) => q.kind === "auto");
  const step = Math.max(1, Math.floor(auto.length / AUTO_SAMPLE));
  return [...why, ...(all ? auto : auto.filter((_, i) => i % step === 0).slice(0, AUTO_SAMPLE))];
}

export function summarize(
  rows: readonly { view?: MossAnswerView; expect: readonly string[] }[],
): Tally {
  let withSources = 0;
  let notInDocs = 0;
  let failed = 0;
  let foundExpected = 0;
  for (const r of rows) {
    if (!r.view) failed++;
    else if (r.view.answered && r.view.sources.length > 0) {
      withSources++;
      if (r.view.sources.some((s) => s.kind === "doc" && r.expect.includes(s.file)))
        foundExpected++;
    } else notInDocs++;
  }
  return { asked: rows.length, withSources, notInDocs, failed, foundExpected };
}

const pct = (n: number, of: number): string =>
  `${of === 0 ? 0 : Math.round((n / of) * 1000) / 10}%`;

async function ask(base: string, q: string): Promise<MossAnswerView | undefined> {
  const res = await fetch(`${base}/api/moss/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screen: "home", question: q, state: {}, actions: [] }),
  });
  return res.ok ? ((await res.json()) as MossAnswerView) : undefined;
}

export async function main(
  argv: readonly string[],
  base = process.env.TERRARIUM_URL ?? "http://127.0.0.1:8787",
): Promise<number> {
  const models = await fetch(`${base}/api/models`).then(
    (r) => (r.ok ? (r.json() as Promise<{ isDefault: boolean }[]>) : []),
    () => [],
  );
  if (!models.some((m) => m.isDefault)) {
    say(`${base} 에 기본 모델이 없어요. 설정에서 모델을 등록하고 기본으로 정한 뒤 다시 해 주세요.`);
    return 2;
  }
  const questions = pick(loadBank(), argv.includes("--all"));
  const rows: { view?: MossAnswerView; expect: readonly string[] }[] = [];
  for (const q of questions) {
    const view = await ask(base, q.q);
    rows.push({ ...(view ? { view } : {}), expect: q.expect });
  }
  const t = summarize(rows);
  say(`질문 ${t.asked}개`);
  say(`  출처를 달고 답함   ${t.withSources}개 (${pct(t.withSources, t.asked)})`);
  say(`  문서에 없어요      ${t.notInDocs}개 (${pct(t.notInDocs, t.asked)})`);
  say(`  답을 못 받음       ${t.failed}개 (${pct(t.failed, t.asked)})`);
  say(`  기대한 문서가 출처  ${t.foundExpected}개 (${pct(t.foundExpected, t.asked)})`);
  if (argv.includes("--record")) {
    const file = JSON.parse(readFileSync(FLOOR_FILE, "utf8")) as Record<string, unknown>;
    file.measured = {
      ...t,
      at: new Date().toISOString().slice(0, 10),
      model: rows.find((r) => r.view)?.view?.model ?? null,
    };
    writeFileSync(FLOOR_FILE, `${JSON.stringify(file, null, 2)}\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(await main(process.argv.slice(2)));

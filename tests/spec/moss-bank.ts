/**
 * 이끼의 질문 은행 (REQ-103, ADR-0124): 문서 조각마다 "X가 뭐예요?" 하나(자동), 그리고 손으로 쓴 "왜" 질문들.
 * 자동 질문은 시험이 돌 때 지금 문서에서 만든다. 커밋하는 `moss-questions.json`에는 손으로 쓴 질문(kind "why")만 있다:
 * 문서를 고칠 때마다 수백 줄이 바뀌어 병렬 변경이 서로 부딪치기 때문이다 (ADR-0194).
 * `pnpm moss-bank`는 그 파일의 모양을 다듬고(자동 질문이 있으면 지운다) 질문 수를 알려 준다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withJosa } from "@terrarium/core/kernel";
import { buildMossIndex, type MossIndex } from "../../apps/server/src/runtime";

const say = (line: string): void => void process.stdout.write(`${line}\n`);

export interface BankQuestion {
  readonly q: string;
  /** 답이 들어 있어도 되는 문서들 (리포 기준 경로): 이 중 하나가 위 세 조각에 있으면 맞은 거예요. */
  readonly expect: readonly string[];
  readonly kind: "auto" | "why";
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANK_PATH = path.join(here, "moss-questions.json");
export const DOCS_DIR = path.join(here, "..", "..", "docs");

const plain = (s: string): string =>
  s
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 조각마다 한 질문. 제목이 문서 안의 소제목이면 문서 이름을 앞에 붙여 같은 제목끼리 헷갈리지 않게 한다. */
export function autoQuestions(index: MossIndex): BankQuestion[] {
  return index.chunks.map((c) => {
    const title = plain(c.title);
    const doc = plain(c.path[0] ?? "");
    const subject = c.path.length > 1 && doc !== title ? `${doc}의 ${title}` : title;
    return { q: `${withJosa(subject, "이")} 뭐예요?`, expect: [c.file], kind: "auto" as const };
  });
}

/** 위 세 조각 가운데 기대한 문서가 있는가. */
export function found(index: MossIndex, question: BankQuestion, top = 3): boolean {
  return index.search(question.q, top).some((h) => question.expect.includes(h.chunk.file));
}

/** 파일에 커밋된, 손으로 쓴 질문만. */
export function loadHandWritten(file = BANK_PATH): BankQuestion[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { questions: BankQuestion[] }).questions.filter(
    (q) => q.kind === "why",
  );
}

let defaultIndex: MossIndex | undefined;

/** 손으로 쓴 질문과, 지금 문서 조각마다 만든 자동 질문. 자동 질문은 읽을 때마다 새로 만들어진다. */
export function loadBank(file = BANK_PATH, index?: MossIndex): BankQuestion[] {
  defaultIndex ??= buildMossIndex(DOCS_DIR);
  return [...loadHandWritten(file), ...autoQuestions(index ?? defaultIndex)];
}

export function writeBank(): number {
  const why = loadHandWritten();
  writeFileSync(BANK_PATH, `${JSON.stringify({ questions: why }, null, 1)}\n`);
  return why.length + autoQuestions(buildMossIndex(DOCS_DIR)).length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  say(
    `${writeBank()}개 질문이 있어요 (손으로 쓴 질문만 파일에 있고, 나머지는 시험이 돌 때 만들어요)`,
  );

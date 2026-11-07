/**
 * 이끼가 모델에게 보내는 말과, 모델이 돌려준 JSON을 읽는 일 (REQ-103, ADR-0124). 순수 함수만 있어서 모델 없이 시험한다.
 */
import { MOSS_SENTENCES_MAX, type MossSourceView } from "@terrarium/core/contract";
import type { MossChunk } from "./moss-index";

export const NOT_IN_DOCS = "문서에 없어요";
const CHUNK_CHARS = 1400;
const STATE_CHARS = 9000;

export const SYSTEM_PROMPT = [
  "너는 '이끼'야. 사용자가 테라리움(IT 인프라 에이전트를 시험하는 시뮬레이터)을 쓰도록 돕는 도우미야.",
  "아래 '문서 조각'과 '지금 화면의 상태'에 적힌 것만으로 답해. 거기 없는 건 지어내지 말고 정확히 \"문서에 없어요\"라고 말해.",
  `해요체로, 최대 ${MOSS_SENTENCES_MAX}문장. 숫자에는 단위를 붙여. 전문용어는 쉬운 말로 풀어 줘.`,
  '답에 쓴 근거를 sources에 넣어. 문서 조각은 [id] 그대로, 화면 상태를 썼다면 "state"를 넣어.',
  "'쓸 수 있는 동작'에 있는 id만 suggestedActions에 넣을 수 있어. 너는 동작을 실행하지 않아. 사용자가 누르게 권할 뿐이야.",
  '반드시 JSON 한 개만 출력해: {"answer": string, "sources": string[], "suggestedActions": string[], "followUps": string[]}',
  "followUps는 이어서 물을 만한 짧은 질문 두세 개.",
].join("\n");

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);

/** 상태 JSON을 프롬프트에 넣을 만큼으로. 너무 크면 앞부분만 두고 줄였다고 적는다. */
export function stateText(state: unknown): string {
  if (state === undefined || state === null) return "{}";
  const text = JSON.stringify(state);
  return text.length <= STATE_CHARS ? text : `${text.slice(0, STATE_CHARS)}…(길어서 줄였어요)`;
}

export function hasState(state: unknown): boolean {
  if (state === undefined || state === null) return false;
  if (typeof state === "object") return Object.keys(state as object).length > 0;
  return true;
}

export interface PromptInput {
  readonly screen: string;
  readonly question: string;
  readonly state: unknown;
  readonly chunks: readonly MossChunk[];
  readonly actions: readonly { readonly id: string; readonly label: string }[];
}

export function userPrompt(input: PromptInput): string {
  const docs =
    input.chunks.length === 0
      ? "(관련 있는 문서 조각을 찾지 못했어요)"
      : input.chunks
          .map((c) => `[${c.id}] ${c.path.join(" › ")}\n${cut(c.text, CHUNK_CHARS)}`)
          .join("\n\n");
  const actions =
    input.actions.length === 0
      ? "(없음)"
      : input.actions.map((a) => `- ${a.id}: ${a.label}`).join("\n");
  return [
    `화면: ${input.screen}`,
    `## 문서 조각\n${docs}`,
    `## 지금 화면의 상태\n${stateText(input.state)}`,
    `## 쓸 수 있는 동작\n${actions}`,
    `## 질문\n${input.question}`,
  ].join("\n\n");
}

/** 문장 끝(. ? ! 다음 공백이나 끝)에서 잘라 앞의 n문장만. */
export function firstSentences(text: string, n = MOSS_SENTENCES_MAX): string {
  const parts = text.trim().match(/[^.?!。]+[.?!。]*\s*/g) ?? [text.trim()];
  return parts.slice(0, n).join("").trim();
}

function jsonOf(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max)
    : [];

export interface ParsedReply {
  readonly answer: string;
  readonly sources: readonly MossSourceView[];
  readonly suggestedActions: readonly string[];
  readonly followUps: readonly string[];
  readonly rough: boolean;
}

function sourceViews(ids: readonly string[], chunks: readonly MossChunk[]): MossSourceView[] {
  const out: MossSourceView[] = [];
  for (const raw of ids) {
    const id = raw.trim().replace(/^\[|\]$/g, "");
    if (id === "state" && !out.some((s) => s.kind === "state")) out.push({ kind: "state" });
    const c = chunks.find((x) => x.id === id);
    if (c && !out.some((s) => s.kind === "doc" && s.id === c.id))
      out.push({ kind: "doc", id: c.id, title: c.title, file: c.file, path: c.path });
  }
  return out;
}

/**
 * 모델의 글을 답으로 읽는다. 화면에 없는 동작 id와 찾아 주지 않은 문서 조각은 버린다(지어낸 출처는 보이지 않는다).
 * JSON이 아니면 글만 세 문장으로 줄여 쓰고 `rough`로 알린다.
 */
export function parseReply(
  text: string,
  chunks: readonly MossChunk[],
  actionIds: readonly string[],
): ParsedReply {
  const json = jsonOf(text) as Record<string, unknown> | undefined;
  if (!json || typeof json.answer !== "string" || json.answer.trim() === "") {
    return {
      answer: firstSentences(text.replace(/```[\s\S]*?```/g, "").trim() || NOT_IN_DOCS),
      sources: [],
      suggestedActions: [],
      followUps: [],
      rough: true,
    };
  }
  return {
    answer: firstSentences(json.answer),
    sources: sourceViews(strings(json.sources, 8), chunks),
    suggestedActions: strings(json.suggestedActions, 4).filter((id) => actionIds.includes(id)),
    followUps: strings(json.followUps, 3).map((q) => cut(q, 80)),
    rough: false,
  };
}

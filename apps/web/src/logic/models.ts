/**
 * 모델 구역 (REQ-099, ADR-0119): the words and the form rules of the settings page's model section, with no screen in
 * them. A card says what was registered and what the last check found; the form turns what was typed into the request.
 */
import type {
  CreateModelRequest,
  LlmModelView,
  ModelCheckView,
  UpdateModelRequest,
} from "@terrarium/core/contract";
import { LLM_KINDS, type LlmKind } from "@terrarium/core/llm";
import { relativeTime } from "./format";

export interface ModelKindCard {
  readonly kind: LlmKind;
  readonly name: string;
  readonly asks: string;
  readonly placeholder: string;
}

/** The three kinds, in the order the cards show them. */
export const MODEL_KIND_CARDS: readonly ModelKindCard[] = [
  {
    kind: "litellm",
    name: "LiteLLM",
    asks: "사내 LiteLLM 게이트웨이",
    placeholder: "https://litellm.example.com",
  },
  {
    kind: "openai",
    name: "OpenAI 호환",
    asks: "/v1/chat/completions 를 받는 API",
    placeholder: "https://api.openai.com",
  },
  {
    kind: "anthropic",
    name: "Claude 호환",
    asks: "/v1/messages 를 받는 API",
    placeholder: "https://api.anthropic.com",
  },
];

export const kindName = (kind: string): string =>
  MODEL_KIND_CARDS.find((c) => c.kind === kind)?.name ?? kind;

export const EMPTY_TITLE = "아직 등록한 모델이 없어요";
export const EMPTY_BODY = "등록해 두면 이끼가 이 모델로 답해요.";
/** Said once under the cards: where the default model is used (이끼, REQ-103) and how rough a small one may be. */
export const LIMIT_LINE =
  "쓰는 곳: 이끼 — 기본 모델이 이끼의 답을 만들어요. 작은 모델이면 이끼의 답이 거칠 수 있어요.";
export const DELETE_NOTE = "등록을 지워요. 저장한 키도 지워져요.";

/** "412ms", or "1.2초" from a second on. */
export const msText = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}초`;

/** What the last check found, as one line and the tone to draw it in. */
export function checkLine(check: ModelCheckView | undefined): {
  readonly tone: "good" | "bad" | "neutral";
  readonly text: string;
} {
  if (!check) return { tone: "neutral", text: "아직 확인하지 않았어요" };
  if (!check.ok) return { tone: "bad", text: check.error ?? "답을 받지 못했어요" };
  const tail =
    check.via === "completion" || check.modelCount === undefined
      ? "짧은 호출로 확인했어요"
      : `모델 ${check.modelCount}개`;
  return { tone: "good", text: `답했어요 · ${msText(check.ms)} · ${tail}` };
}

/** "3분 전 확인", or nothing before the first check. */
export const checkedWhen = (
  check: ModelCheckView | undefined,
  nowMs: number,
): string | undefined => (check ? `${relativeTime(check.at, nowMs)} 확인` : undefined);

/** The line of facts under a card's name: address, the default model's name, the key's end. */
export function cardFacts(view: LlmModelView): string[] {
  return [
    view.baseUrl,
    view.defaultModel ? `기본 모델 ${view.defaultModel}` : "기본 모델 이름 없음",
    view.hasKey ? `키 ${view.keyHint ?? "저장됨"}` : "키 없음",
  ];
}

/** What deleting says will happen; the default one names where the default goes. */
export function deleteText(view: LlmModelView, others: number): string {
  return view.isDefault && others > 0
    ? `${DELETE_NOTE} 기본이던 모델이라, 가장 먼저 등록한 모델이 기본이 돼요.`
    : DELETE_NOTE;
}

/** 이끼는 기본 모델이 있어야만 깨어난다 (REQ-103, ADR-0125): 목록에 기본 모델이 하나라도 있는가. 아직 못 읽었으면 없는 걸로 쳐요. */
export const hasDefaultModel = (list: readonly LlmModelView[] | undefined): boolean =>
  (list ?? []).some((m) => m.isDefault);

/** 설정 화면이 모델을 더하거나 바꾸거나 지우면 window에 보내는 알림. 이끼가 기본 모델 여부를 다시 읽어요. */
export const MODELS_CHANGED = "terrarium:models-changed";

/** 모델이 없을 때 이끼 자리에 남는 작은 알약의 글과, 눌렀을 때 가는 곳. */
export const MOSS_SLEEP_LINE = "모델을 등록하면 이끼가 깨어나요 → 설정";
export const MODELS_HASH = "#models";

export type ModelSectionState = "loading" | "empty" | "list";

export function sectionState(list: readonly LlmModelView[] | undefined): ModelSectionState {
  if (!list) return "loading";
  return list.length === 0 ? "empty" : "list";
}

// ── the form ─────────────────────────────────────────────────────────────────

export interface HeaderRow {
  readonly name: string;
  readonly value: string;
  /** Registered before: its value stays on the server, so an empty value box means "keep". */
  readonly kept: boolean;
}

export interface ModelForm {
  readonly kind: LlmKind | "";
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly clearKey: boolean;
  readonly defaultModel: string;
  readonly headers: readonly HeaderRow[];
}

export const blankModelForm = (kind: LlmKind | "" = ""): ModelForm => ({
  kind,
  name: "",
  baseUrl: "",
  apiKey: "",
  clearKey: false,
  defaultModel: "",
  headers: [],
});

export const formOfModel = (view: LlmModelView): ModelForm => ({
  kind: view.kind,
  name: view.name,
  baseUrl: view.baseUrl,
  apiKey: "",
  clearKey: false,
  defaultModel: view.defaultModel ?? "",
  headers: view.headers.map((name) => ({ name, value: "", kept: true })),
});

/** Which step a dialog opens on: the kind for a new one, the fields when a kind is known or it is being changed. */
export function firstStep(existing: LlmModelView | undefined, kind: LlmKind | ""): "kind" | "form" {
  return existing || kind ? "form" : "kind";
}

export function isKind(value: string): value is LlmKind {
  return (LLM_KINDS as readonly string[]).includes(value);
}

/** What is wrong with the form before anything is sent, by field. */
export function modelProblems(form: ModelForm): Record<string, string> {
  const out: Record<string, string> = {};
  if (form.kind === "") out.kind = "종류를 골라 주세요";
  if (form.name.trim() === "") out.name = "이름을 적어 주세요";
  if (form.baseUrl.trim() === "") out.baseUrl = "주소를 적어 주세요";
  else if (!/^https?:\/\/[^\s/]+/i.test(form.baseUrl.trim()))
    out.baseUrl = "http:// 나 https:// 로 시작하는 주소여야 해요";
  const seen = new Set<string>();
  form.headers.forEach((h, i) => {
    const name = h.name.trim().toLowerCase();
    if (name === "") out[`headers.${i}`] = "헤더 이름을 적어 주세요";
    else if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(h.name.trim()))
      out[`headers.${i}`] = "헤더 이름에 쓸 수 없는 글자가 있어요";
    else if (seen.has(name)) out[`headers.${i}`] = "같은 이름의 헤더가 있어요";
    else if (h.value === "" && !h.kept) out[`headers.${i}`] = "값을 적어 주세요";
    seen.add(name);
  });
  return out;
}

/** The body for a new registration. Empty optional boxes are left out. */
export function createBody(form: ModelForm): CreateModelRequest {
  return {
    kind: form.kind as LlmKind,
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    ...(form.defaultModel.trim() ? { defaultModel: form.defaultModel.trim() } : {}),
    headers: form.headers.map((h) => ({ name: h.name.trim(), value: h.value })),
  };
}

/** The body for a change: an empty key box keeps the key, a kept header sends no value. */
export function updateBody(form: ModelForm): UpdateModelRequest {
  return {
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    defaultModel: form.defaultModel.trim(),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    ...(form.clearKey ? { clearKey: true } : {}),
    headers: form.headers.map((h) =>
      h.value === "" && h.kept ? { name: h.name.trim() } : { name: h.name.trim(), value: h.value },
    ),
  };
}

/**
 * LLM API 등록 (REQ-099, ADR-0119): 워크스페이스가 나중에 결과 해석과 안내에 쓸 모델 연결. 키와 헤더 값은 서버에만 있고
 * 어느 응답에도 나오지 않아요(키는 마지막 네 글자만).
 */
import { LLM_KINDS, type LlmFailReason, type LlmKind } from "@terrarium/core/llm";
import { z } from "zod";

export const MODEL_NAME_MAX = 60;
export const MODEL_HEADERS_MAX = 10;

const Kind = z.enum(LLM_KINDS);
const Name = z.string().trim().min(1).max(MODEL_NAME_MAX);
const Address = z.string().trim().min(1).max(500);
const Key = z.string().trim().max(2000);
const ModelName = z.string().trim().max(200);
const HeaderName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "헤더 이름에 쓸 수 없는 글자가 있어요");
const HeaderValue = z.string().max(2000);

/** 새 모델. 키·기본 모델 이름·헤더는 없어도 돼요(게이트웨이 중에는 키가 없는 곳도 있어요). */
export const CreateModelBody = z
  .object({
    kind: Kind,
    name: Name,
    baseUrl: Address,
    apiKey: Key.optional(),
    defaultModel: ModelName.optional(),
    headers: z
      .array(z.object({ name: HeaderName, value: HeaderValue.min(1) }).strict())
      .max(MODEL_HEADERS_MAX)
      .default([]),
  })
  .strict();

/**
 * 고치기. 안 보낸 칸은 그대로예요. `apiKey`를 비우거나 빼면 기존 키가 남고, 지우려면 `clearKey`를 보내요.
 * 헤더는 목록 전체를 보내고, `value`가 없는 줄은 같은 이름의 기존 값을 그대로 둬요.
 */
export const UpdateModelBody = z
  .object({
    name: Name.optional(),
    baseUrl: Address.optional(),
    apiKey: Key.optional(),
    clearKey: z.boolean().optional(),
    defaultModel: ModelName.optional(),
    headers: z
      .array(z.object({ name: HeaderName, value: HeaderValue.optional() }).strict())
      .max(MODEL_HEADERS_MAX)
      .optional(),
  })
  .strict();

export type CreateModelRequest = z.output<typeof CreateModelBody>;
export type UpdateModelRequest = z.output<typeof UpdateModelBody>;

/** 마지막으로 확인한 결과와 때. */
export interface ModelCheckView {
  readonly at: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly via?: "models" | "completion";
  /** 목록이 준 모델 이름(최대 200개). 답이 한 번의 짧은 호출이었으면 비어 있어요. */
  readonly models: readonly string[];
  readonly modelCount?: number;
  readonly reason?: LlmFailReason;
  readonly error?: string;
}

export interface LlmModelView {
  readonly id: string;
  readonly name: string;
  readonly kind: LlmKind;
  readonly baseUrl: string;
  readonly defaultModel?: string;
  readonly hasKey: boolean;
  /** `…ab12`. 키 전체는 어디에도 나오지 않아요. */
  readonly keyHint?: string;
  /** 헤더 이름만. 값은 나오지 않아요. */
  readonly headers: readonly string[];
  readonly isDefault: boolean;
  readonly owner: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly lastCheck?: ModelCheckView;
}

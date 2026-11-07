/**
 * 이끼 — 테라리움 도우미의 요청과 답 (REQ-103, ADR-0124). 서버는 질문·화면·화면의 상태(JSON)·쓸 수 있는 동작의 이름을 받아
 * 문서 조각과 함께 모델에 묻고, 답만 돌려준다. 동작은 서버가 실행하지 않는다: 화면(클라이언트)이 등록된 동작 중에서 골라 눌러 준다.
 */
import { z } from "zod";

export const MOSS_QUESTION_MAX = 500;
export const MOSS_ACTIONS_MAX = 40;
/** 답은 세 문장 안. */
export const MOSS_SENTENCES_MAX = 3;

export const MossAskBody = z
  .object({
    /** 지금 화면의 이름(`Page["name"]`). */
    screen: z.string().trim().min(1).max(40),
    question: z.string().trim().min(1).max(MOSS_QUESTION_MAX),
    /** 화면이 읽어 준 구조화된 상태. 크면 서버가 줄여서 써요. */
    state: z.unknown().optional(),
    /** 이 화면에 등록된 동작. 모델은 이 중에서만 권해요. */
    actions: z
      .array(z.object({ id: z.string().trim().min(1).max(60), label: z.string().max(60) }).strict())
      .max(MOSS_ACTIONS_MAX)
      .default([]),
  })
  .strict();

export type MossAskRequest = z.output<typeof MossAskBody>;

/** 답의 출처: 문서 조각 하나, 아니면 "지금 화면의 상태". */
export type MossSourceView =
  | {
      readonly kind: "doc";
      readonly id: string;
      readonly title: string;
      readonly file: string;
      readonly path: readonly string[];
    }
  | { readonly kind: "state" };

export interface MossAnswerView {
  /** 세 문장 안. 문서에도 화면에도 없으면 "문서에 없어요"로 시작해요. */
  readonly answer: string;
  /** 문서나 화면 상태에서 찾아 답했는가. */
  readonly answered: boolean;
  readonly sources: readonly MossSourceView[];
  /** 이 화면에 등록된 동작의 id. 화면이 "하기"로 보여 줘요. */
  readonly suggestedActions: readonly string[];
  readonly followUps: readonly string[];
  /** 답한 모델의 등록 이름. */
  readonly model: string;
  /** 모델의 답을 JSON으로 읽지 못해 글만 건졌다면 true. */
  readonly rough?: boolean;
}

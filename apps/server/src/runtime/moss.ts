/**
 * 이끼 (REQ-103, ADR-0124): 질문 하나에 문서 조각과 화면 상태로 답한다. 기본 모델에게 묻고, 동작은 하지 않는다 —
 * 어떤 동작을 권할지만 돌려주고, 누르는 것은 화면이 한다.
 */
import {
  type MossAnswerView,
  type MossAskRequest,
  UnavailableError,
} from "@terrarium/core/contract";
import { LlmError } from "@terrarium/core/llm";
import type { Models } from "./models";
import { isRelevant, LOW_SCORE, type MossChunk, type MossIndex, mossIndexFor } from "./moss-index";
import { hasState, NOT_IN_DOCS, parseReply, SYSTEM_PROMPT, userPrompt } from "./moss-prompt";

const TOP = 4;

export const NO_MODEL = "등록한 모델이 없어요. 설정에서 모델을 등록하면 이끼가 깨어나요";

export interface MossOptions {
  /** 문서 폴더. 없으면 찾아보고, 그래도 없으면 문서 없이 화면 상태로만 답해요. */
  readonly docsDir?: string;
  readonly index?: MossIndex;
  /** 모델이 답에 쓸 수 있는 토큰 수. */
  readonly maxTokens?: number;
}

export class Moss {
  private cached: MossIndex | undefined;

  constructor(
    private readonly models: Models,
    private readonly options: MossOptions = {},
  ) {}

  /** 색인을 읽어 둔다(서버가 시작할 때). */
  get index(): MossIndex {
    this.cached ??= this.options.index ?? mossIndexFor(this.options.docsDir);
    return this.cached;
  }

  /** 색인을 지금 만들고 조각 수를 돌려준다. */
  warm(): number {
    return this.index.size;
  }

  /** 질문에 맞는 문서 조각. 점수가 낮으면 한 조각도 주지 않는다. */
  retrieve(question: string): MossChunk[] {
    const hits = this.index.search(question, TOP);
    return hits[0] && isRelevant(hits[0])
      ? hits.filter((h) => h.score >= LOW_SCORE * 0.6).map((h) => h.chunk)
      : [];
  }

  async ask(input: MossAskRequest): Promise<MossAnswerView> {
    const model = await this.models.defaultClient();
    if (!model) throw new UnavailableError(NO_MODEL);
    const chunks = this.retrieve(input.question);
    // 문서에도 화면에도 근거가 없으면 모델에게 묻지 않는다: 지어낼 틈을 주지 않는다.
    if (chunks.length === 0 && !hasState(input.state)) return nothing(model.name);
    try {
      const done = await model.client.complete({
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: userPrompt({
              screen: input.screen,
              question: input.question,
              state: input.state,
              chunks,
              actions: input.actions,
            }),
          },
        ],
        ...(model.model ? { model: model.model } : {}),
        maxTokens: this.options.maxTokens ?? 700,
      });
      const reply = parseReply(
        done.text,
        chunks,
        input.actions.map((a) => a.id),
      );
      return {
        answer: reply.answer,
        answered: reply.sources.length > 0 && !reply.answer.includes(NOT_IN_DOCS),
        sources: reply.sources,
        suggestedActions: reply.suggestedActions,
        followUps: reply.followUps,
        model: model.name,
        ...(reply.rough ? { rough: true } : {}),
      };
    } catch (err) {
      if (err instanceof LlmError)
        throw new UnavailableError(`모델이 답하지 않았어요. ${err.message}`);
      throw err;
    }
  }
}

function nothing(model: string): MossAnswerView {
  return {
    answer: `${NOT_IN_DOCS}. 문서에서 찾지 못했어요.`,
    answered: false,
    sources: [],
    suggestedActions: [],
    followUps: [],
    model,
  };
}

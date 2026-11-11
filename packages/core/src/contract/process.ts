/**
 * 프로세스 비교 (REQ-112, ADR-0135): 시나리오마다 사람이 적는 "지금 하는 방식" 표, 실험 결과의 전후 비교와 단계 장부, 세계 단위의
 * 온톨로지 요구. 적은 값과 잰 값은 이름부터 달라요: 적은 값은 "지금 하는 방식(적은 값)", 잰 값은 "테라리움에서 잰 값".
 */
import type {
  LedgerRow,
  OntologyNeeds,
  OntologyUse,
  ProcessNumbers,
} from "@terrarium/core/analysis";
import {
  type CurrentProcessStep,
  PROCESS_MAX_MINUTES,
  PROCESS_MAX_STEPS,
  PROCESS_STEP_KINDS,
} from "@terrarium/core/experiments";
import { z } from "zod";

export const PROCESS_WHO_MAX = 40;
export const PROCESS_WHAT_MAX = 120;

const Step = z
  .object({
    who: z.string().trim().min(1, "누가 하는지 적어 주세요").max(PROCESS_WHO_MAX),
    what: z.string().trim().min(1, "무엇을 하는지 적어 주세요").max(PROCESS_WHAT_MAX),
    minutes: z.number().int().min(0).max(PROCESS_MAX_MINUTES),
    kind: z.enum(PROCESS_STEP_KINDS as unknown as [string, ...string[]]),
  })
  .strict();

export const PutCurrentProcessBody = z
  .object({ steps: z.array(Step).min(1, "단계를 하나 이상 적어 주세요").max(PROCESS_MAX_STEPS) })
  .strict();
export type PutCurrentProcessRequest = z.output<typeof PutCurrentProcessBody>;

export const WorldOntologyQuery = z
  .object({ experimentId: z.string().trim().min(1).max(80).optional() })
  .strict();
export type WorldOntologyQueryParams = z.output<typeof WorldOntologyQuery>;

/** 시나리오의 "지금 하는 방식". 아직 안 적었으면 `steps`가 비어 있고 `written`이 거짓이에요. */
export interface CurrentProcessView {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly worldId: string;
  readonly written: boolean;
  readonly steps: readonly CurrentProcessStep[];
  /** 단계 수 · 사람 수(서로 다른 "누가") · 걸리는 시간, 적은 값에서 더한 숫자. */
  readonly summary: ProcessNumbers;
  readonly owner?: string;
  /** 고칠 수 있는가: 시나리오를 만든 사람과 관리자만 (ADR-0174). */
  readonly canEdit: boolean;
  readonly updatedAt?: string;
}

/** 실험 하나의 전후 비교: 잰 값(실행들의 평균)과, 적은 표가 있으면 그 값, 그리고 대표 실행의 장부. */
export interface ProcessCompareView {
  readonly experimentId: string;
  readonly scenarioId: string;
  /** 시나리오가 저장돼 있는가. 운영 실험에는 없어서 적은 표를 달 수 없어요. */
  readonly hasScenario: boolean;
  readonly scenarioName: string;
  /** 끝난 실행 수 = "N번 평균"의 N. */
  readonly runs: number;
  readonly measured?: ProcessNumbers;
  readonly baseline?: ProcessNumbers;
  readonly delta?: ProcessNumbers;
  /** 장부로 보여 주는 실행(평균에 가장 가까운 것). */
  readonly ledger?: {
    readonly runId: string;
    readonly index: number;
    readonly rows: readonly LedgerRow[];
    readonly tools: number;
    readonly remaining: string;
  };
}

export interface OntologyExperimentOption {
  readonly id: string;
  readonly name: string;
}

/** 세계 단위의 온톨로지 요구와, 고른 실험에서 실제로 쓴 것. */
export interface WorldOntologyView {
  readonly worldId: string;
  readonly worldName: string;
  readonly needs: OntologyNeeds;
  /** 이 세계에서 돌린 실험들(최근 순). 고르는 칸을 채워요. */
  readonly experiments: readonly OntologyExperimentOption[];
  readonly experimentId?: string;
  readonly use?: OntologyUse;
}

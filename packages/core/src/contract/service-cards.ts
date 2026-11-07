/**
 * 서비스 카드와 빠른 실험 (REQ-104, ADR-0127): 사람이 "내 카드"로 저장한 서비스, 그리고 세계 하나에서 권장값으로
 * 실험을 바로 시작하는 한 번의 요청. 카드의 모양은 늘 기본 제공 카드의 것이라 이름과 피해 숫자만 담겨요.
 */
import { SERVICE_CATALOG } from "@terrarium/core/world";
import { z } from "zod";
import type { TitleView } from "./community";

export const CARD_NAME_MAX = 60;

const CardId = z.string().refine((id) => SERVICE_CATALOG.some((c) => c.id === id), {
  message: "기본 제공 카드에 없는 카드예요",
});
const Name = z.string().trim().min(1).max(CARD_NAME_MAX);
const Harm = z
  .array(
    z
      .object({
        name: z.string().trim().min(1).max(120),
        perHourKrw: z.number().int().min(0).max(1_000_000_000_000),
      })
      .strict(),
  )
  .max(6);

export const CreateServiceCardBody = z
  .object({
    name: Name,
    card: CardId,
    harm: Harm.optional(),
    shared: z.boolean().default(false),
  })
  .strict();

export const UpdateServiceCardBody = z
  .object({
    name: Name.optional(),
    harm: Harm.optional(),
    shared: z.boolean().optional(),
  })
  .strict();

/** 다른 사람의 공유 카드를 복사해 내 카드로: 이름만 바꿀 수 있고, 복사본은 내 것이며 공유하지 않은 채로 시작해요. */
export const CopyServiceCardBody = z.object({ name: Name.optional() }).strict();

export type CopyServiceCardRequest = z.output<typeof CopyServiceCardBody>;
export type CreateServiceCardRequest = z.output<typeof CreateServiceCardBody>;
export type UpdateServiceCardRequest = z.output<typeof UpdateServiceCardBody>;

export interface ServiceCardView {
  readonly id: string;
  readonly name: string;
  readonly card: string;
  readonly harm?: readonly { readonly name: string; readonly perHourKrw: number }[];
  readonly owner: string;
  readonly ownerTitles: readonly TitleView[];
  readonly shared: boolean;
  /** Whether the person asking may change it: only the owner does (REQ-108, ADR-0131: a card is always locked). */
  readonly canEdit: boolean;
  readonly createdAt: string;
}

/** 세계에서 권장값으로 실험을 한 번에: 어느 시나리오를 쓸지만 (안 보내면 이 세계에서 만들 수 있는 전부) 말해요. */
export const QuickExperimentBody = z
  .object({ templateIds: z.array(z.string().min(1).max(80)).max(300).optional() })
  .strict();
export type QuickExperimentRequest = z.output<typeof QuickExperimentBody>;

export interface QuickExperimentView {
  readonly experimentId: string;
  /** Scenarios the faults were taken from. */
  readonly scenarios: number;
  readonly faults: number;
  readonly runs: number;
  /** World hours one run lasts; the clock is real time, so this is also how long a run takes. */
  readonly hours: number;
  readonly harnessId: string;
  readonly agentId: string;
  readonly agentName: string;
  /** Why this agent: the latest one the person used, or the built-in operator. */
  readonly agentFrom: "recent" | "builtin";
}

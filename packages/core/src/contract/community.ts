/**
 * 세계 인기·좋아요·칭호 (REQ-101, ADR-0122): 세계 목록의 정렬과 근거, 좋아요 한 번, 사람의 칭호.
 * 점수는 서버가 이미 있는 기록(실험·세계)과 좋아요 표에서 계산해 목록에 실어 보내요.
 */
import { WORLD_SORTS, type WorldStats, type WorldSummary } from "@terrarium/core/experiments";
import { z } from "zod";

/** `GET /api/worlds?sort=` — 빼면 인기 순이에요. */
export const WorldListQuery = z.object({ sort: z.enum(WORLD_SORTS).optional() }).strict();
export type WorldListQueryParams = z.output<typeof WorldListQuery>;

/** 칭호 하나. 이름이 곧 조건이라서(숫자와 단위가 이름에 있어요) 단계나 색은 없어요. */
export interface TitleView {
  /** 안 바뀌는 이름표(`runs-100`, `first-world` …). */
  readonly key: string;
  /** 사람이 읽는 이름: "실험 100번". */
  readonly label: string;
  /** 무엇을 하면 얻는지 한 문장. */
  readonly means: string;
  /** 얻은 때. 한 번 얻으면 없어지지 않아요. */
  readonly earnedAt: string;
}

export interface UserTitlesView {
  readonly user: string;
  /** 보여 줄 차례대로: 앞의 둘이 이름 옆에 나와요. */
  readonly titles: readonly TitleView[];
}

/** 세계 카드 하나: 세계 요약에 근거(숫자)와 좋아요, 만든 사람의 칭호를 더한 것. */
export type WorldCardView = WorldSummary & {
  readonly stats: WorldStats;
  readonly likes: number;
  readonly likedByMe: boolean;
  readonly ownerTitles: readonly TitleView[];
  /** Whether the person asking may change who sees it. */
  readonly canChangeScope?: boolean;
};

export interface LikeView {
  readonly worldId: string;
  readonly likes: number;
  readonly likedByMe: boolean;
}

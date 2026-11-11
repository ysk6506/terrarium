/** 세계 인기·좋아요·칭호의 경로(REQ-101, ADR-0122). routes.ts의 표에 펼쳐 넣어요. */
import { WorldListQuery } from "./community";
import type { RouteSpec } from "./routes";

const json = "json" as const;

export const COMMUNITY_ROUTES = {
  listWorlds: {
    method: "GET",
    path: "/api/worlds",
    summary:
      "세계 목록 — sort=popular(기본)·active·new·mine. 카드마다 실험·좋아요·이번 주 근거와 만든 사람의 칭호가 실려 와요",
    query: WorldListQuery,
    produces: json,
    policy: "signedIn",
  },
  likeWorld: {
    method: "POST",
    path: "/api/worlds/:id/like",
    summary: "세계에 좋아요 (사람마다 세계마다 하나, 다시 눌러도 하나)",
    produces: json,
    policy: { action: "like" },
  },
  unlikeWorld: {
    method: "DELETE",
    path: "/api/worlds/:id/like",
    summary: "좋아요 취소",
    produces: json,
    policy: { action: "like" },
  },
  userTitles: {
    method: "GET",
    path: "/api/users/:id/titles",
    summary: "한 사람이 얻은 칭호 전부와 얻은 때 (:id는 사람 이름)",
    produces: json,
    policy: "signedIn",
  },
} as const satisfies Record<string, RouteSpec>;

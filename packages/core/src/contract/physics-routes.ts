/** 세계의 물리 프로필과 물리 자리 목록의 세 경로(REQ-113, ADR-0137). routes.ts의 표에 펼쳐 넣어요. */
import type { PhysicsProfile } from "@terrarium/core/physics/slots";
import { z } from "zod";
import type { RouteSpec } from "./routes";
import { PhysicsProfileSchema } from "./schemas";

const json = "json" as const;

export const PutPhysicsBody = z
  .object({
    /** 바꾼 물리. 기본 물리(아무것도 안 바꾼 것)를 보내면 이 세계는 기본 물리로 돌아가요. */
    profile: PhysicsProfileSchema,
    /** 읽을 때 본 세계의 digest. 그사이 바뀌었으면 거절해요. */
    baseDigest: z.string().min(1).max(128),
  })
  .strict();

export type PutPhysicsRequest = { readonly profile: PhysicsProfile; readonly baseDigest: string };

export const PHYSICS_ROUTES = {
  listPhysicsSlots: {
    method: "GET",
    path: "/api/physics/slots",
    summary: "물리가 닿는 자리들: 숫자(단위·기본값·허용 범위)와 곡선 이름, 입력과 출력",
    produces: json,
  },
  getWorldPhysics: {
    method: "GET",
    path: "/api/worlds/:id/physics",
    summary: "이 세계의 물리 프로필과 지문 (바꾸지 않았으면 기본 물리 v1)",
    produces: json,
  },
  putWorldPhysics: {
    method: "PUT",
    path: "/api/worlds/:id/physics",
    summary:
      "이 세계의 물리 프로필 저장 (만든 사람만, 버전 확인). 새 세계 버전이 되고 지문이 달라져요",
    body: PutPhysicsBody,
    produces: json,
  },
} as const satisfies Record<string, RouteSpec>;

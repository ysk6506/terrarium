/**
 * 새 세계 화면이 이끼에게 내놓는 읽기와 동작 (REQ-103, ADR-0124). 모두 화면의 `flow`와 "세계 만들기" 버튼이 쓰는 `make`를 부른다.
 */
import type { ShapeSpec } from "@terrarium/core/sources/worldgen";
import { shapeState, useMossScreen } from "../../moss";
import type { Flow } from "./shape-flow";

export interface ShapeMoss {
  readonly spec: ShapeSpec;
  readonly flow: Pick<Flow, "go">;
  readonly step: string;
  /** 마지막 화면인가(여기서만 만들 수 있어요). */
  readonly last: boolean;
  readonly problem: string | undefined;
  readonly make: () => Promise<void>;
}

export function useShapeMoss({ spec, flow, step, last, problem, make }: ShapeMoss): void {
  useMossScreen("newWorld", {
    read: () => shapeState(spec, step, problem),
    summary: () => `${spec.name} · 서버 ${spec.servers ?? "알아서"}대`,
    run: {
      "world-ladders": () => {
        flow.go("ladders");
        return "층마다 모양을 고르는 사다리 화면이에요";
      },
      "world-build": async () => {
        if (!last) {
          flow.go("size");
          return "마지막 화면으로 넘겼어요. 거기서 세계 만들기를 다시 눌러 주세요";
        }
        if (problem) throw new Error(problem);
        await make();
      },
    },
  });
}

import { describe, expect, it } from "vitest";
import { IAP_LOAD, SERVICE_CATALOG } from "./index";
import {
  dataText,
  downtimeText,
  LOAD_LIMITS,
  loadProblem,
  loadText,
  type ServiceLoad,
} from "./service-load";

describe("서비스가 받는 숫자 [REQ-109]", () => {
  it("[REQ-109] 한 줄은 '초당 300 · 2 TB · 사용자 1,200 · 중단 허용 1분'처럼 읽힌다", () => {
    expect(loadText({ rps: 300, dataGB: 2_000, users: 1_200, maxDowntimeS: 60 })).toBe(
      "초당 300 · 2 TB · 사용자 1,200 · 중단 허용 1분",
    );
    expect(
      loadText({ rps: 1, dataGB: 20_000, users: 30, maxDowntimeS: 7_200, gpuHours: 5_000 }),
    ).toBe("초당 1 · 20 TB · 사용자 30 · 중단 허용 2시간 · GPU 5,000시간");
  });

  it("[REQ-109] 데이터와 허용 중단은 사람이 말하는 단위로 쓴다", () => {
    expect(dataText(300)).toBe("300 GB");
    expect(dataText(2_500)).toBe("2.5 TB");
    expect(downtimeText(30)).toBe("30초");
    expect(downtimeText(90)).toBe("1분 30초");
    expect(downtimeText(3_600)).toBe("1시간");
  });

  it("[REQ-109] 기본 제공 카드 열 장 모두 숫자가 있고 한계 안이며, 학습만 GPU 시간이 있다", () => {
    for (const c of SERVICE_CATALOG) {
      expect(loadProblem(c.load), c.id).toBeUndefined();
      expect(c.load.gpuHours !== undefined && c.load.gpuHours > 0, c.id).toBe(
        c.id === "training-pipeline",
      );
    }
    expect(loadProblem(IAP_LOAD)).toBeUndefined();
  });

  it("[REQ-109] 한계를 벗어나거나 숫자가 아니면 어느 숫자가 문제인지 말한다", () => {
    const ok: ServiceLoad = { rps: 1, dataGB: 1, users: 1, maxDowntimeS: 1 };
    expect(loadProblem({ ...ok, maxDowntimeS: 0 })).toMatch(/허용 중단/);
    expect(loadProblem({ ...ok, rps: -1 })).toMatch(/초당 요청/);
    expect(loadProblem({ ...ok, users: Number.NaN })).toMatch(/동시 사용자/);
    expect(loadProblem({ ...ok, dataGB: LOAD_LIMITS.dataGB.max + 1 })).toMatch(/데이터/);
  });
});

import { describe, expect, it } from "vitest";
import {
  MIN_PIXEL_RATIO,
  pixelRatioFor,
  planQuality,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MIN,
  QualityGovernor,
  SLOW_FRAME_MS,
  VERY_SLOW_FRAME_MS,
  WARMUP_FRAMES,
} from "./quality";

describe("a big screen is drawn at a lower ratio so the pixel count stays bounded [REQ-036]", () => {
  it("a laptop screen keeps the ratio it asks for", () => {
    expect(pixelRatioFor(QUALITY_HIGH, 1.5, 1280, 720)).toBe(1.5);
    expect(pixelRatioFor(QUALITY_HIGH, 2, 1000, 600)).toBe(2);
  });

  it("never asks for more than the quality allows, or than the screen has", () => {
    expect(pixelRatioFor(QUALITY_MIN, 2, 400, 300)).toBe(1);
    expect(pixelRatioFor(QUALITY_LOW, 3, 400, 300)).toBe(1.25);
    expect(pixelRatioFor(QUALITY_HIGH, 1, 400, 300)).toBe(1);
    expect(pixelRatioFor(QUALITY_HIGH, 0, 400, 300)).toBe(1);
  });

  it("a big monitor at a high ratio ends up near the pixel budget of each quality", () => {
    for (const q of [QUALITY_HIGH, QUALITY_LOW, QUALITY_MIN]) {
      const ratio = pixelRatioFor(q, 2, 2560, 1440);
      const drawn = 2560 * ratio * 1440 * ratio;
      expect(drawn).toBeLessThanOrEqual(q.maxPixels * 1.02);
      expect(ratio).toBeGreaterThanOrEqual(MIN_PIXEL_RATIO);
    }
  });

  it("the budgets go down with the quality: 3 million, 2 million, 1.2 million", () => {
    expect([QUALITY_HIGH, QUALITY_LOW, QUALITY_MIN].map((q) => q.maxPixels)).toEqual([
      3_000_000, 2_000_000, 1_200_000,
    ]);
  });

  it("an enormous canvas is not drawn below half a pixel per screen pixel", () => {
    expect(pixelRatioFor(QUALITY_MIN, 2, 7680, 4320)).toBe(MIN_PIXEL_RATIO);
  });

  it("a canvas that has no size yet does not divide by zero", () => {
    expect(pixelRatioFor(QUALITY_HIGH, 2, 0, 0)).toBe(2);
  });
});

describe("the blur is part of the quality and is left out when it is none [REQ-036]", () => {
  it("is half the old strength at the top, as strong in the middle, and none at the lightest", () => {
    expect([QUALITY_HIGH.blur, QUALITY_LOW.blur, QUALITY_MIN.blur]).toEqual([0.5, 0.5, 0]);
  });
});

describe("slow is 25 ms and very slow is 50 ms [REQ-036]", () => {
  it("the limits are the ones asked for", () => {
    expect([SLOW_FRAME_MS, VERY_SLOW_FRAME_MS]).toEqual([25, 50]);
  });

  it("a frame of 30 ms (33 a second) is already too slow for the full picture", () => {
    const g = new QualityGovernor();
    let said: ReturnType<QualityGovernor["frame"]>;
    for (let i = 0; i < WARMUP_FRAMES + 8; i++) said = g.frame(30) ?? said;
    expect(said).toBe(QUALITY_LOW);
  });
});

describe("what a person chose beats the machine, and the address beats what was saved [REQ-036]", () => {
  const card = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070)";
  const soft = "SwiftShader";

  it("automatic leaves the choice to the machine and does not pin it", () => {
    expect(planQuality(card, null, "auto")).toEqual({ quality: QUALITY_HIGH, fixed: false });
    expect(planQuality(soft, null, "auto")).toEqual({ quality: QUALITY_MIN, fixed: false });
  });

  it("high and light are pinned, even on a machine that draws with its processor", () => {
    expect(planQuality(soft, null, "high")).toEqual({ quality: QUALITY_HIGH, fixed: true });
    expect(planQuality(card, null, "light")).toEqual({ quality: QUALITY_MIN, fixed: true });
  });

  it("a name in the address wins over the saved choice and pins too", () => {
    expect(planQuality(card, "min", "high")).toEqual({ quality: QUALITY_MIN, fixed: true });
    expect(planQuality(card, "LOW", "light")).toEqual({ quality: QUALITY_LOW, fixed: true });
  });

  it("a name that means nothing is ignored", () => {
    expect(planQuality(card, "banana", "light")).toEqual({ quality: QUALITY_MIN, fixed: true });
    expect(planQuality(card, "banana", "auto")).toEqual({ quality: QUALITY_HIGH, fixed: false });
  });

  it("a pinned picture is never timed, so the judge cannot lower it", () => {
    const g = new QualityGovernor(QUALITY_HIGH);
    g.pin(true);
    expect(g.measuring()).toBe(false);
    g.pin(false);
    expect(g.measuring()).toBe(true);
  });
});

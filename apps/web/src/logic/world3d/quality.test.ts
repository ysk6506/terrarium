import { describe, expect, it } from "vitest";
import {
  JUDGE_FRAMES,
  lighter,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MIN,
  QualityGovernor,
  RECHECK_FRAMES,
  SLOW_FRAME_MS,
  STALL_MS,
  startQuality,
  VERY_SLOW_FRAME_MS,
  WARMUP_FRAMES,
} from "./quality";

/** Feed a governor `n` timed frames that each cost `ms`; return the last change it asked for. */
const feed = (g: QualityGovernor, n: number, ms: number) => {
  let said: ReturnType<QualityGovernor["frame"]>;
  for (let i = 0; i < n; i++) said = g.frame(ms) ?? said;
  return said;
};

const WINDOW = WARMUP_FRAMES + JUDGE_FRAMES;

describe("the 3D picture gets lighter on a machine that cannot keep up [REQ-036]", () => {
  it("a fast machine keeps the full picture, however long it runs", () => {
    const g = new QualityGovernor();
    expect(feed(g, WINDOW, 8)).toBeUndefined();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < RECHECK_FRAMES; i++) g.passed();
      expect(g.measuring()).toBe(true);
      expect(feed(g, JUDGE_FRAMES + 1, 8)).toBeUndefined();
    }
    expect(g.quality).toBe(QUALITY_HIGH);
  });

  it("a slow machine drops one step: contact shadows, big shadow map and full speed go, the look stays", () => {
    const g = new QualityGovernor();
    expect(feed(g, WINDOW, SLOW_FRAME_MS + 10)).toBe(QUALITY_LOW);
    expect(g.quality).toBe(QUALITY_LOW);
    expect(QUALITY_LOW.ao).toBe(false);
    expect(QUALITY_LOW.shadow).toBeLessThan(QUALITY_HIGH.shadow);
    expect(QUALITY_LOW.maxFps).toBeGreaterThan(0);
    expect(QUALITY_LOW.pixelRatio).toBeLessThan(QUALITY_HIGH.pixelRatio);
  });

  it("a machine far too slow skips straight to the lightest picture", () => {
    const g = new QualityGovernor();
    expect(feed(g, WINDOW, VERY_SLOW_FRAME_MS + 100)).toBe(QUALITY_MIN);
    expect(QUALITY_MIN.samples).toBe(0);
    expect(QUALITY_MIN.maxFps).toBeLessThan(QUALITY_LOW.maxFps);
  });

  it("goes down one step at a time, and stops timing frames at the lightest", () => {
    const g = new QualityGovernor();
    expect(feed(g, WINDOW, 40)).toBe(QUALITY_LOW);
    expect(g.measuring()).toBe(true);
    expect(feed(g, WINDOW, 200)).toBe(QUALITY_MIN);
    expect(g.measuring()).toBe(false);
    expect(g.quality).toBe(QUALITY_MIN);
  });

  it("one frame that stalls lowers the picture at once, once the warm-up is over", () => {
    const g = new QualityGovernor();
    feed(g, WARMUP_FRAMES, 8);
    expect(g.frame(STALL_MS + 1)).toBe(QUALITY_MIN);
  });

  it("never goes back up, so the picture does not flicker between two looks", () => {
    expect(lighter(QUALITY_MIN, 1)).toBeUndefined();
    expect(lighter(QUALITY_LOW, 1)).toBeUndefined();
    const g = new QualityGovernor();
    feed(g, WINDOW, 40);
    feed(g, WINDOW * 4, 1);
    expect(g.quality).toBe(QUALITY_LOW);
  });

  it("the first frames after the start or a change do not count: shaders compile then", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < WARMUP_FRAMES; i++) expect(g.frame(STALL_MS * 4)).toBeUndefined();
    expect(feed(g, JUDGE_FRAMES, 10)).toBeUndefined();
    expect(g.quality).toBe(QUALITY_HIGH);
  });

  it("one hiccup in a fast stream does not lower the picture", () => {
    const g = new QualityGovernor();
    feed(g, WARMUP_FRAMES + 2, 8);
    g.frame(300);
    expect(feed(g, JUDGE_FRAMES, 8)).toBeUndefined();
    expect(g.quality).toBe(QUALITY_HIGH);
  });

  it("frames are timed in runs, with a long rest between: timing a frame waits for the graphics card", () => {
    const g = new QualityGovernor();
    feed(g, WINDOW, 8);
    expect(g.measuring()).toBe(false);
    for (let i = 0; i < RECHECK_FRAMES - 1; i++) {
      g.passed();
      expect(g.measuring()).toBe(false);
    }
    g.passed();
    expect(g.measuring()).toBe(true);
  });

  it("a world that got heavy is noticed at the next run of timed frames", () => {
    const g = new QualityGovernor();
    feed(g, WINDOW, 8);
    for (let i = 0; i < RECHECK_FRAMES; i++) g.passed();
    expect(feed(g, JUDGE_FRAMES + 1, SLOW_FRAME_MS + 20)).toBe(QUALITY_LOW);
  });

  it("choosing a quality by hand starts the judging again from there", () => {
    const g = new QualityGovernor();
    feed(g, WINDOW, 60);
    g.set(QUALITY_HIGH);
    expect(g.quality).toBe(QUALITY_HIGH);
    expect(g.measuring()).toBe(true);
    expect(feed(g, WINDOW - 1, 60)).toBeUndefined();
  });
});

describe("the picture to start with [REQ-036]", () => {
  it("is the full picture on a graphics card", () => {
    expect(
      startQuality("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)", null),
    ).toBe(QUALITY_HIGH);
    expect(
      startQuality("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", null),
    ).toBe(QUALITY_HIGH);
    expect(startQuality("", null)).toBe(QUALITY_HIGH);
  });

  it("is the light picture where the processor does the drawing: a remote desktop, a server", () => {
    for (const name of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Microsoft Basic Render Driver",
      "ANGLE (Mesa, Software Rasterizer)",
    ])
      expect(startQuality(name, null)).toBe(QUALITY_MIN);
  });

  it("follows a name in the address first, so a person can ask for it either way", () => {
    expect(startQuality("SwiftShader", "high")).toBe(QUALITY_HIGH);
    expect(startQuality("NVIDIA GeForce", "min")).toBe(QUALITY_MIN);
    expect(startQuality("NVIDIA GeForce", "LOW")).toBe(QUALITY_LOW);
    expect(startQuality("SwiftShader", "banana")).toBe(QUALITY_MIN);
  });
});

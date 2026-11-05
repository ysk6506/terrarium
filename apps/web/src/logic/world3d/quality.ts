/**
 * How good the 3D picture is, and when to make it lighter (REQ-036). The design is the same at every step:
 * only the costly extras go (contact shadows, a big shadow map, the blur, drawing at full speed). A machine
 * without a graphics card (a remote desktop, software drawing) would otherwise freeze the whole page.
 */
export interface Quality {
  readonly name: "high" | "low" | "min";
  /** Ambient occlusion: contact shadows in corners. */
  readonly ao: boolean;
  /** Shadow map size, pixels. */
  readonly shadow: 1024 | 2048 | 4096;
  /** Most frames drawn per second while something moves; 0 is no limit. */
  readonly maxFps: number;
  /** The most device pixels drawn per screen pixel (a sharp screen asks for 2). */
  readonly pixelRatio: number;
  /** The most pixels drawn in all: a big monitor draws at a lower ratio instead of paying for millions of them. */
  readonly maxPixels: number;
  /** How strong the tilt-shift blur is, as a share of what each level of the view asks for; 0 leaves the blur pass out. */
  readonly blur: 0 | 0.5 | 1;
  /** Multisampling of the picture before the effects; 0 is none. */
  readonly samples: 0 | 2 | 4;
  /** Smoothing of jagged edges as a last step over the whole picture. */
  readonly smaa: boolean;
}

export const QUALITY_HIGH: Quality = {
  name: "high",
  ao: true,
  shadow: 4096,
  maxFps: 0,
  pixelRatio: 2,
  maxPixels: 3_000_000,
  blur: 0.5,
  samples: 4,
  smaa: true,
};
export const QUALITY_LOW: Quality = {
  name: "low",
  ao: false,
  shadow: 1024,
  maxFps: 30,
  pixelRatio: 1.25,
  maxPixels: 2_000_000,
  blur: 0.5,
  samples: 2,
  smaa: true,
};
export const QUALITY_MIN: Quality = {
  name: "min",
  ao: false,
  shadow: 1024,
  maxFps: 12,
  pixelRatio: 1,
  maxPixels: 1_200_000,
  blur: 0,
  samples: 0,
  smaa: false,
};

const BY_NAME: Readonly<Record<string, Quality>> = {
  high: QUALITY_HIGH,
  low: QUALITY_LOW,
  min: QUALITY_MIN,
};

/** Drawing done by the processor, not a graphics card: remote desktops and servers show these names. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|microsoft basic/i;

/** Never draw below this many device pixels per screen pixel, however big the screen. */
export const MIN_PIXEL_RATIO = 0.5;

/**
 * The device pixels to draw per screen pixel: what the screen asks for, kept under the quality's ratio and
 * under its pixel budget. A 4K monitor at a ratio of 2 would draw 33 million pixels with ambient occlusion
 * on each; the budget turns that into the ratio that costs about what a laptop pays.
 */
export function pixelRatioFor(
  quality: Quality,
  deviceRatio: number,
  width: number,
  height: number,
): number {
  const fit = Math.sqrt(quality.maxPixels / Math.max(1, width * height));
  const wanted = Math.min(deviceRatio > 0 ? deviceRatio : 1, quality.pixelRatio, fit);
  return Math.max(MIN_PIXEL_RATIO, Math.round(wanted * 100) / 100);
}

/** What a person chose for the graphics: leave it to the machine, or pin it. */
export type GraphicsChoice = "auto" | "high" | "light";

/** A picture and whether it is pinned (the judge of frame times leaves a pinned one alone). */
export interface Planned {
  readonly quality: Quality;
  readonly fixed: boolean;
}

/**
 * The picture to start with and whether to keep it. A name in the address wins over what was saved, and
 * both pin the picture; with neither, `startQuality` decides and the governor may lower it later.
 */
export function planQuality(
  graphics: string,
  asked: string | null,
  saved: GraphicsChoice,
): Planned {
  const named = asked ? BY_NAME[asked.toLowerCase()] : undefined;
  if (named) return { quality: named, fixed: true };
  if (saved === "high") return { quality: QUALITY_HIGH, fixed: true };
  if (saved === "light") return { quality: QUALITY_MIN, fixed: true };
  return { quality: startQuality(graphics, null), fixed: false };
}

/** The event the page hears when the picture was made lighter by itself (not when a person chose). */
export const QUALITY_EVENT = "terrarium:quality-lowered";
/** What the page tells a person when it happens. */
export const QUALITY_NOTICE = "그래픽을 가볍게 바꿨어요. 설정에서 되돌릴 수 있어요";

/**
 * The picture to start with. A name in the address (`?quality=low`) wins, so a person can ask for it; then a
 * machine that draws with its processor starts light (its first frame would otherwise take many seconds);
 * everything else starts with the full picture and only gets lighter if frames turn out slow.
 */
export function startQuality(graphics: string, asked: string | null): Quality {
  const named = asked ? BY_NAME[asked.toLowerCase()] : undefined;
  if (named) return named;
  return SOFTWARE.test(graphics) ? QUALITY_MIN : QUALITY_HIGH;
}

/** A frame that costs more than this (ms, 40 frames a second) makes the picture lighter. */
export const SLOW_FRAME_MS = 25;
/** A frame this slow skips a step: the machine cannot draw the full picture at all. */
export const VERY_SLOW_FRAME_MS = 50;
/** One frame this slow lowers the picture at once, without waiting for an average. */
export const STALL_MS = 1500;
/** Frames ignored after the start or a change (shaders compile then), and frames weighed before judging. */
export const WARMUP_FRAMES = 3;
export const JUDGE_FRAMES = 8;
/** Drawn frames between two judgings, once the picture has been judged fine. Timing a frame stops the pipeline. */
export const RECHECK_FRAMES = 240;

/** The picture to move to for a frame that costs `ms`, or nothing to stay as it is. Never goes back up. */
export function lighter(current: Quality, ms: number): Quality | undefined {
  if (current === QUALITY_HIGH && ms > SLOW_FRAME_MS)
    return ms > VERY_SLOW_FRAME_MS ? QUALITY_MIN : QUALITY_LOW;
  if (current === QUALITY_LOW && ms > VERY_SLOW_FRAME_MS) return QUALITY_MIN;
  return undefined;
}

/**
 * Judges how fast frames are and says when to move to a lighter picture. Timing a frame means waiting for
 * the graphics card to finish it, so only some frames are timed: a run of them at the start and after every
 * change, then a run now and then in case the world got heavier. It judges an average, not one hiccup.
 */
export class QualityGovernor {
  private cost = 0;
  private seen = 0;
  private quiet = 0;
  private pinned = false;

  constructor(private current: Quality = QUALITY_HIGH) {}

  /** A pinned picture is never judged: the person chose it. */
  pin(on: boolean): void {
    this.pinned = on;
  }

  get quality(): Quality {
    return this.current;
  }

  /** Someone chose a quality by hand; judge again from there. */
  set(quality: Quality): void {
    this.current = quality;
    this.seen = 0;
    this.quiet = 0;
  }

  /** Should the frame about to be drawn be timed? The lightest picture has nowhere lower to go. */
  measuring(): boolean {
    return !this.pinned && this.quiet === 0 && this.current !== QUALITY_MIN;
  }

  /** A frame was drawn without being timed. */
  passed(): void {
    if (this.quiet > 0 && --this.quiet === 0) this.seen = WARMUP_FRAMES - 1;
  }

  /** Report the cost of one timed frame (ms). Returns the lighter quality when it is time to change. */
  frame(ms: number): Quality | undefined {
    this.seen++;
    if (this.seen <= WARMUP_FRAMES) return undefined;
    if (ms > STALL_MS) return this.lower(ms);
    this.cost = this.seen === WARMUP_FRAMES + 1 ? ms : this.cost * 0.7 + ms * 0.3;
    if (this.seen < WARMUP_FRAMES + JUDGE_FRAMES) return undefined;
    const next = this.lower(this.cost);
    // Fine as it is: leave it alone for a while.
    if (!next) this.quiet = RECHECK_FRAMES;
    return next;
  }

  private lower(ms: number): Quality | undefined {
    const next = lighter(this.current, ms);
    if (next) {
      this.current = next;
      this.seen = 0;
      this.quiet = 0;
    }
    return next;
  }
}

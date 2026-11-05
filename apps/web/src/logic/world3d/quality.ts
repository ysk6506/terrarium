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
  samples: 4,
  smaa: true,
};
export const QUALITY_LOW: Quality = {
  name: "low",
  ao: false,
  shadow: 1024,
  maxFps: 30,
  pixelRatio: 1.25,
  samples: 2,
  smaa: true,
};
export const QUALITY_MIN: Quality = {
  name: "min",
  ao: false,
  shadow: 1024,
  maxFps: 12,
  pixelRatio: 1,
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

/** A frame that costs more than this (ms) makes the picture lighter. */
export const SLOW_FRAME_MS = 40;
/** A frame this slow skips a step: the machine cannot draw the full picture at all. */
export const VERY_SLOW_FRAME_MS = 90;
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

  constructor(private current: Quality = QUALITY_HIGH) {}

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
    return this.quiet === 0 && this.current !== QUALITY_MIN;
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

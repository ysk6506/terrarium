/**
 * The cats and birds of the site as the view holds them (REQ-105, ADR-0128): a click on one (or the key that
 * greets the nearest) makes it answer, plays its sound when the 소리 setting is on, and shows one line for 2 s
 * in the same bubble as the people of a room. Animals are not buttons and not equipment: the click is theirs
 * alone and never reaches what is behind them. (Not a moss action: the handler path is a canvas click.)
 */
import * as THREE from "three";
import { readSettings, world3d } from "../../logic";
import { browserStore } from "../browser-store";
import { AnimalAudio } from "./animal-audio";
import type { Say } from "./crew-stage";
import type { Engine } from "./engine";
import type { LifeLayer } from "./life-layer";
import { calm } from "./view-look";

export interface AnimalHost {
  life(): LifeLayer | undefined;
  size(): { readonly w: number; readonly h: number };
  camera(): THREE.Camera;
  /** Whether sound is wanted (the 소리 setting), asked at every click. */
  sound(): boolean;
  /** Whether less motion was asked for. */
  calm(): boolean;
  /** Plays the sound of a kind after a delay in seconds. */
  play(kind: world3d.ReactiveKind, delay: number): void;
}

/** How near a click must be to an animal, in pixels. */
const GRAB_PX = 26;

export class AnimalStage {
  private readonly listeners = new Set<(say: Say | undefined) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly engine: Engine,
    private readonly host: AnimalHost,
  ) {}

  private screenOf(at: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = this.v.copy(at).project(this.host.camera());
    const { w, h } = this.host.size();
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, visible: p.z > -1 && p.z < 1 };
  }

  /** The animal under a pixel of the canvas, if there is one close enough. */
  hit(x: number, y: number): number | undefined {
    let best: number | undefined;
    let bestD = GRAB_PX;
    for (const a of this.host.life()?.animals() ?? []) {
      const s = this.screenOf(a.at);
      const d = Math.hypot(s.x - x, s.y - y);
      if (s.visible && d < bestD) {
        best = a.id;
        bestD = d;
      }
    }
    return best;
  }

  /** A click: the animal under it answers. Returns whether one was hit. */
  click(x: number, y: number): boolean {
    const id = this.hit(x, y);
    if (id === undefined) return false;
    this.answer(id);
    return true;
  }

  /** The key for greeting an animal: the one nearest the middle of the picture answers. False if none is in view. */
  greet(): boolean {
    const { w, h } = this.host.size();
    let best: number | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const a of this.host.life()?.animals() ?? []) {
      const s = this.screenOf(a.at);
      const d = Math.hypot(s.x - w / 2, s.y - h / 2);
      if (s.visible && d < bestD) {
        best = a.id;
        bestD = d;
      }
    }
    if (best === undefined) return false;
    this.answer(best);
    return true;
  }

  private answer(id: number): void {
    const life = this.host.life();
    const found = life?.animals().find((a) => a.id === id);
    if (!life || !found) return;
    const calm = this.host.calm();
    life.poke(id, calm);
    const cues = world3d.cuesOf(found.kind, calm);
    if (this.host.sound()) this.host.play(found.kind, cues.soundAt);
    const say: Say = {
      text: cues.text,
      person: id,
      at: () => {
        const now = life.animals().find((a) => a.id === id);
        return now ? this.screenOf(now.at) : { x: 0, y: 0, visible: false };
      },
    };
    this.clear();
    this.later(cues.textAt, () => this.emit(say));
    this.later(cues.textAt + cues.textFor, () => this.emit(undefined));
    this.engine.invalidate();
  }

  private later(seconds: number, run: () => void): void {
    if (seconds <= 0) {
      run();
      return;
    }
    const t = setTimeout(() => {
      this.timers.delete(t);
      run();
    }, seconds * 1000);
    this.timers.add(t);
  }

  private clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Be told when a line is said and when it ends. */
  onSay(listener: (say: Say | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(say: Say | undefined): void {
    for (const l of this.listeners) l(say);
  }

  dispose(): void {
    this.clear();
    this.emit(undefined);
    this.listeners.clear();
  }
}

/** The animal stage with its sound and its settings wired in (the 소리 setting is read at every click). */
export function animalsFor(
  engine: Engine,
  parts: Pick<AnimalHost, "life" | "size" | "camera">,
): { readonly stage: AnimalStage; dispose(): void } {
  const audio = new AnimalAudio();
  const stage = new AnimalStage(engine, {
    ...parts,
    sound: () => readSettings(browserStore()).sound === "on",
    calm,
    play: (kind, delay) => audio.play(kind, delay),
  });
  return {
    stage,
    dispose: () => {
      stage.dispose();
      audio.dispose();
    },
  };
}

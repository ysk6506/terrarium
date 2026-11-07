/**
 * The meow and the chirp, made on the spot with WebAudio (REQ-105, ADR-0128): oscillators shaped by the
 * notes of `world3d.notesOf`, no sound files. The audio context is only made when someone clicks an animal
 * (browsers keep it silent until then anyway), and nothing here ever plays by itself.
 */
import { world3d } from "../../logic";

type Ctor = typeof AudioContext;

export class AnimalAudio {
  private ctx: AudioContext | undefined;

  /** Play the sound of a cat or a bird `delay` seconds from now; a machine without audio stays quiet. */
  play(kind: world3d.ReactiveKind, delay = 0): void {
    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!Context) return;
      this.ctx ??= new Context();
      const ctx = this.ctx;
      void ctx.resume();
      const t0 = ctx.currentTime + delay;
      for (const n of world3d.notesOf(kind)) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = n.wave;
        const at = t0 + n.start;
        osc.frequency.setValueAtTime(n.from, at);
        osc.frequency.linearRampToValueAtTime(n.to, at + n.dur);
        const env = world3d.envelopeOf(n);
        gain.gain.setValueAtTime(0, at);
        for (const p of env.slice(1)) gain.gain.linearRampToValueAtTime(p.v, at + p.t);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + n.dur + 0.02);
      }
    } catch {
      // no audio here: the text still shows
    }
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
  }
}

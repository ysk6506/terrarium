/**
 * What an operation run adds to a session (REQ-090, ADR-0094): the planned faults, played into the world as their time
 * comes (`fault.add`, cause `generator`), and the clock that decides how fast the world runs. The session calls
 * `tick` after every physics step and `step` when the host syncs it to the wall clock.
 */
import {
  type Fault,
  type FaultType,
  GENERATOR_CAUSE,
  type WorldCommand,
} from "@terrarium/core/world";
import {
  type ClockMemory,
  type ClockReason,
  type ClockStep,
  clockStep,
  noteCall,
  START_CLOCK,
} from "./clock";
import type { OperationConfig } from "./config";
import type { PlannedFault } from "./generator";

/** What the driver asks of the session. */
export interface DriverPort {
  readonly now: () => number;
  readonly apply: (command: WorldCommand, cause: string) => void;
  /** The fault ids that exist now (a planned fault whose id is taken is left out). */
  readonly faults: () => readonly Pick<Fault, "id">[];
  /** True when a fault of this type is left out of the run (the experiment limits faults to the tools given). */
  readonly skip?: (type: FaultType) => boolean;
  /** Alarms raised and team events written since this was last asked. */
  readonly fresh: () => { readonly alarms: number; readonly teamEvents: number };
}

export class OperationDriver {
  private next = 0;
  private memory: ClockMemory = START_CLOCK;
  private lastElapsed = 0;
  private origin = 0;
  private begun = false;
  private readonly skipped: PlannedFault[] = [];
  private lastReason: ClockReason = "realtime";
  private lastSpeed = 1;

  constructor(
    readonly config: OperationConfig,
    private readonly plan: readonly PlannedFault[],
    private readonly port: DriverPort,
  ) {}

  /** The agent has its task: faults are counted from here. */
  begin(originT: number): void {
    this.origin = originT;
    this.begun = true;
  }

  get faults(): readonly PlannedFault[] {
    return this.plan;
  }

  /** The faults that did not happen because the tools could not reach them. */
  get left(): readonly PlannedFault[] {
    return this.skipped;
  }

  /** The next planned fault's world time. */
  nextWakeAt(): number | undefined {
    const f = this.begun ? this.plan[this.next] : undefined;
    return f ? this.origin + f.at : undefined;
  }

  /** Play the faults that are due. */
  tick(): void {
    if (!this.begun) return;
    for (let f = this.plan[this.next]; f && this.origin + f.at <= this.port.now() + 1e-9; ) {
      this.next++;
      this.play(f);
      f = this.plan[this.next];
    }
  }

  private play(f: PlannedFault): void {
    const taken = this.port.faults().some((x) => x.id === f.id);
    if (taken || this.port.skip?.(f.type)) {
      this.skipped.push(f);
      return;
    }
    try {
      this.port.apply(
        {
          type: "fault.add",
          fault: { id: f.id, type: f.type, target: f.target, params: f.params ?? {} },
        },
        GENERATOR_CAUSE,
      );
    } catch {
      // a fault the world refuses (a target that is gone, a value out of range) is left out, never ends the run
      this.skipped.push(f);
    }
  }

  /** The agent made a call. */
  touch(): void {
    this.memory = noteCall(this.memory, this.lastElapsed);
  }

  /** How much world time to move for the real time up to `elapsed` seconds after the task began. */
  step(elapsed: number): ClockStep {
    const dt = elapsed - this.lastElapsed;
    const fresh = this.port.fresh();
    const s = clockStep(this.config.pace, this.memory, elapsed, dt, {
      newAlarms: fresh.alarms,
      newTeamEvents: fresh.teamEvents,
    });
    this.memory = s.memory;
    this.lastElapsed = elapsed;
    this.lastReason = s.reason;
    this.lastSpeed = s.speed;
    return s;
  }

  /** How the clock runs now, for the mid-run card. */
  get pace(): { readonly speed: number; readonly reason: ClockReason } {
    return { speed: this.lastSpeed, reason: this.lastReason };
  }
}

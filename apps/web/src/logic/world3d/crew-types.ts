/**
 * The shapes the people of a server room are described with (REQ-074, ADR-0078): who they are, what is the
 * matter, and where each one stands. The rules that fill them in are in `crew.ts` and `crew-plan.ts`.
 */
import type { Aisle, Grid, Poly } from "./crew-route";
import type { Pt } from "./plan";
import type { RoomScene } from "./room";

export type CrewRole = "engineer" | "manager" | "technician";
export type CrewPose = "walk" | "stand" | "work" | "sit";
export type CrewSituation =
  | "patrol"
  | "going"
  | "working"
  | "agent"
  | "manager"
  | "technician"
  | "partner";

/** An alarm on a machine of the room, as the crew needs it. */
export interface CrewAlarm {
  /** The rack or machine it stands at. */
  readonly device: string;
  readonly severity: "warning" | "critical";
  /** Simulated seconds it has lasted. */
  readonly ageS: number;
}

/** A run that acted on a machine of the room. */
export interface CrewActivity {
  readonly device: string;
  readonly runId: string;
}

/**
 * What is the matter now. `from` is the clock time (seconds, the same clock as `t`) at which this
 * state began, so the walk can start then; `before` is the state it replaced, so a person who was at a
 * machine walks back instead of jumping.
 */
export interface CrewWorld {
  readonly alarms: readonly CrewAlarm[];
  readonly activity: readonly CrewActivity[];
  readonly partners?: readonly CrewPartner[];
  readonly from?: number;
  readonly before?: CrewWorld;
}

/** Another team is working on a machine of the room (REQ-093): a technician walks in from the door to it. */
export interface CrewPartner {
  readonly device: string;
  /** "교체 중 · 벤더", "작업 중 · 네트워크 팀". */
  readonly text: string;
  readonly replacing: boolean;
}

export const NO_TROUBLE: CrewWorld = { alarms: [], activity: [] };

export interface CrewPerson {
  readonly id: number;
  readonly role: CrewRole;
  /** 0..1: picks the face and the build. */
  readonly tone: number;
  readonly patrol?: Poly;
  readonly speed: number;
  readonly dwell: number;
  readonly offset: number;
  /** Where a person without a patrol stands, and which way. */
  readonly home: Pt;
  readonly homeRot: number;
  readonly sits: boolean;
}

export interface Desk {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

export interface Dev {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly rack: boolean;
}

export interface Crew {
  readonly scene: RoomScene;
  readonly people: readonly CrewPerson[];
  readonly door: Pt;
  readonly desk?: Desk;
  readonly grid: Grid;
  readonly aisles: readonly Aisle[];
  readonly devices: ReadonlyMap<string, Dev>;
  readonly spots: Map<string, Pt>;
}

export interface CrewState {
  readonly id: number;
  readonly role: CrewRole;
  readonly tone: number;
  /** A technician is only there while called. */
  readonly present: boolean;
  readonly x: number;
  readonly z: number;
  /** Turn about the vertical axis, radians; 0 faces +z. */
  readonly rot: number;
  readonly pose: CrewPose;
  /** The machine this person is walking to or working at. */
  readonly device?: string;
  readonly forAgent: boolean;
  /** Working for another team's hand-off, not for an alarm. */
  readonly forPartner?: boolean;
  readonly situation: CrewSituation;
}

export interface CrewOptions {
  /** Everyone stands (the person asked for less motion). */
  readonly still?: boolean;
}

/** Walking speed, metres a second. */
export const WALK_MPS = 1.2;
/** A critical alarm that has lasted this long (simulated seconds) brings a technician. */
export const TECHNICIAN_AFTER_S = 120;

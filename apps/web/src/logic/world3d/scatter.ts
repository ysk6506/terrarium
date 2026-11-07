/** The trees and parked cars a site shows; where they stand is decided by `campus-plan` (REQ-105). */
import type { Bounds } from "./plan";
export interface Tree {
  readonly x: number;
  readonly z: number;
  /** 0.6 .. 1.5 */
  readonly scale: number;
  /** 0..1, picks a shade of green. */
  readonly tint: number;
}

export interface Car {
  readonly x: number;
  readonly z: number;
  /** Turn about the vertical axis, radians. */
  readonly rot: number;
  /** Index into the view's paint colours. */
  readonly paint: number;
  /** Height of the ground it stands on (a car park's roof); 0 when left out. */
  readonly y?: number;
}

export interface ParkingLot {
  readonly forId: string;
  readonly area: Bounds;
  readonly cars: readonly Car[];
}

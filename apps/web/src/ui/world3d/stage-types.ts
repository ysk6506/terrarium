/** What the 3D stage tells the builder about the pointer, in the plan of the level being edited. */
export interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

/** What the next click would build: its corner, size and height on the plan, and whether it may go there. */
export interface Ghost {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly ok: boolean;
}

export interface StageEvents {
  onHover?(point: PlanPoint | undefined, hit: string | undefined): void;
  onClick?(point: PlanPoint, hit: string | undefined, mods: { readonly shift: boolean }): void;
  onDoubleClick?(point: PlanPoint, hit: string | undefined): void;
  /** Return true at "start" to take the drag (tool or move); otherwise the drag turns the camera. */
  onDrag?(
    phase: "start" | "move" | "end",
    from: PlanPoint,
    to: PlanPoint,
    hit: string | undefined,
  ): boolean | undefined;
}

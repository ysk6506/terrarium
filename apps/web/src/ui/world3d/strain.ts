/** A frame longer than this counts against the machine, seconds. */
const SLOW_FRAME_S = 0.08;
/** Net seconds of slow frames after which a nicety (the visitors, the slow turn) switches itself off. */
const SLOW_LIMIT_S = 4;

/** Counts the frames that were too slow and says when there have been too many. */
export class Strain {
  private slow = 0;

  /** Feed one frame's length; true when the machine has struggled long enough. */
  frame(dt: number): boolean {
    this.slow = Math.max(0, this.slow + (dt > SLOW_FRAME_S ? dt : -dt));
    return this.slow > SLOW_LIMIT_S;
  }

  reset(): void {
    this.slow = 0;
  }
}

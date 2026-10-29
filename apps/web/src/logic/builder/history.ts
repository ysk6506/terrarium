/** Undo and redo for the builder and the editor: snapshots of immutable values, newest last. */

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private present: T,
    private readonly limit = 100,
  ) {}

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record a new value; whatever was undone is gone. */
  push(next: T): void {
    if (next === this.present) return;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }

  undo(): T {
    const previous = this.past.pop();
    if (previous === undefined) return this.present;
    this.future.push(this.present);
    this.present = previous;
    return previous;
  }

  redo(): T {
    const next = this.future.pop();
    if (next === undefined) return this.present;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  /** Start over from a value (after loading or saving elsewhere). */
  reset(value: T): void {
    this.past = [];
    this.future = [];
    this.present = value;
  }
}

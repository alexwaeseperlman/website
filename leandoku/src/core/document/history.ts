/** Undo/redo over immutable snapshots. Selection travels with the document. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private current: T,
    private readonly limit = 200,
  ) {}

  get value(): T {
    return this.current;
  }

  push(next: T): void {
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
  }

  undo(): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

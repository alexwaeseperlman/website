/** A cache bounded by an estimate of retained bytes, evicting least recently used first. */
export class ByteLru<V> {
  private readonly map = new Map<string, { value: V; bytes: number }>();
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, bytes: number): void {
    const old = this.map.get(key);
    if (old) {
      this.total -= old.bytes;
      this.map.delete(key);
    }
    if (bytes > this.maxBytes) return;
    this.map.set(key, { value, bytes });
    this.total += bytes;
    for (const [k, v] of this.map) {
      if (this.total <= this.maxBytes) break;
      this.map.delete(k);
      this.total -= v.bytes;
    }
  }

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.total;
  }
}

/**
 * Single-flight / request coalescing.
 *
 * THE PROBLEM IT SOLVES (cache stampede):
 * A popular search — "Hyderabad → Bengaluru, tomorrow" — is served from cache.
 * The entry expires. In the next 40ms, 300 concurrent requests all miss, all
 * hit Postgres with the same expensive availability query, and the database
 * falls over. This is the single most common cause of "the site is fine until
 * it suddenly isn't" in ticketing systems.
 *
 * With single-flight, exactly ONE of those 300 executes the loader; the other
 * 299 await the same promise. Throughput to the database is bounded by the
 * number of *distinct* keys, not by request volume.
 *
 * Used by: the cache service (L1/L2 fill), fare computation, master-data reads.
 */
export class SingleFlight<T = unknown> {
  private readonly inFlight = new Map<string, Promise<T>>();

  async do(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => loader())().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Number of distinct loads currently executing — exported as a metric. */
  get size(): number {
    return this.inFlight.size;
  }

  /** Drop tracking for a key (does not cancel the underlying work). */
  forget(key: string): void {
    this.inFlight.delete(key);
  }
}

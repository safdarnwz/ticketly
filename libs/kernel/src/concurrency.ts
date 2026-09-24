/**
 * Run `fn` over `items` with at most `limit` in flight at once, preserving
 * input order in the output. Used wherever one request fans out to many
 * operators/rows: an unbounded Promise.all over N items can take the whole
 * DB connection pool and stall every other request on the instance.
 *
 * A rejected item rejects the whole call (like Promise.all) — callers that
 * want per-item isolation catch inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('mapWithConcurrency: limit must be a positive integer');
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

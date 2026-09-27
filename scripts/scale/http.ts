/**
 * A small HTTP client for the scale scripts: JSON in and out, the API base
 * from SCALE_API (default http://localhost:3100/api/v1), an idempotency key
 * when asked, and a few retries on network errors or 5xx.
 */
export const API = process.env.SCALE_API ?? 'http://localhost:3100/api/v1';

export interface Res<T = any> {
  status: number;
  body: T;
}

export async function call<T = any>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  idem?: string,
): Promise<Res<T>> {
  const h: Record<string, string> = { ...headers };
  let payload: string | Uint8Array | undefined;
  if (body instanceof Uint8Array) {
    h['content-type'] = 'application/octet-stream';
    payload = body;
  } else if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (idem) h['idempotency-key'] = idem;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const r = await fetch(API + path, { method, headers: h, body: payload as never });
      const text = await r.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (r.status >= 500 && attempt < 3) {
        await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
        continue;
      }
      return { status: r.status, body: parsed as T };
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
}

/** Throw with the API's message unless the status is 2xx. */
export function ok<T>(r: Res<T>, what: string): T {
  if (r.status < 200 || r.status >= 300) {
    const detail = (r.body as { detail?: string })?.detail ?? JSON.stringify(r.body).slice(0, 300);
    throw new Error(`${what}: ${r.status} ${detail}`);
  }
  return r.body;
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

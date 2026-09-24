import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import type { Observable } from 'rxjs';

/**
 * Normalises values that JSON.stringify handles badly or not at all.
 *
 *  - `bigint`  → string. `JSON.stringify(1n)` THROWS; a single bigint leaking
 *    from a `count(*)` would 500 an otherwise fine endpoint.
 *  - `Date`    → ISO-8601 UTC. Explicit, so a future `toJSON` override on a
 *    Date subclass cannot change the wire format.
 *  - `Map`/`Set` → object/array, because `JSON.stringify(new Map())` is `{}`
 *    and silently loses data.
 *  - `undefined` object properties are dropped (Fastify's serialiser keeps the
 *    key with `null` in some paths).
 *
 * Objects that define their own `toJSON` (our `Money`, and every DTO) are left
 * alone — that is the extension point.
 *
 * PERFORMANCE: this walks the response object. For very large payloads
 * (report exports, manifests) prefer streaming and skip the interceptor with
 * `@SkipSerialization()`.
 */
@Injectable()
export class SerializationInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => normalise(value)));
  }
}

const MAX_DEPTH = 24;

function normalise(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return value;

  const type = typeof value;
  if (type === 'bigint') return (value as bigint).toString();
  if (type !== 'object') return value;

  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalise(item, depth + 1));
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of value) out[String(key)] = normalise(item, depth + 1);
    return out;
  }
  if (value instanceof Set) return [...value].map((item) => normalise(item, depth + 1));
  if (value instanceof Buffer) return value.toString('base64');

  // Respect explicit serialisation contracts (Money, DTOs, domain VOs).
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = normalise(item, depth + 1);
  }
  return out;
}

import { AppConfig } from '../../config/configuration';

export class DigioError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/**
 * Minimal Digio REST client: Basic auth with client id / secret, JSON bodies.
 * Base URL: sandbox https://ext.digio.in:444, production https://api.digio.in.
 */
export class DigioClient {
  constructor(private readonly cfg: AppConfig['digio'], private readonly fetchImpl: typeof fetch = fetch) {}

  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.apiBase}${path}`, {
        method,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new DigioError(`Digio unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new DigioError(`Digio ${method} ${path.split('?')[0]} failed with ${res.status}`, res.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DigioError('Digio returned invalid JSON');
    }
  }
}

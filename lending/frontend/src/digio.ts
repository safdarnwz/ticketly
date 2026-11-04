/** Loads Digio's Web SDK on demand and runs one KYC or eSign flow with it. */
export interface DigioSession {
  provider: 'sandbox' | 'digio';
  requestId: string;
  accessTokenId: string | null;
  identifier: string;
  sdk: { url: string; environment: 'sandbox' | 'production' } | null;
}

declare global {
  interface Window {
    Digio?: new (opts: Record<string, unknown>) => { init: () => void; submit: (id: string, identifier: string, token?: string) => void };
  }
}

const loaded = new Map<string, Promise<void>>();
function loadScript(url: string) {
  if (!loaded.has(url)) {
    loaded.set(url, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loaded.delete(url); reject(new Error('Could not load Digio. Check your internet connection and try again.')); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(url)!;
}

/** Resolves when the customer closes or finishes the Digio flow. The server then checks the real result. */
export async function runDigio(session: DigioSession): Promise<{ errorCode?: string }> {
  if (!session.sdk) throw new Error('Not a Digio session');
  await loadScript(session.sdk.url);
  if (typeof window.Digio !== 'function') throw new Error('Digio could not start.');
  return new Promise((resolve) => {
    const d = new window.Digio!({
      environment: session.sdk!.environment,
      is_iframe: true,
      callback: (r: { error_code?: string }) => resolve({ errorCode: r?.error_code }),
    });
    d.init();
    if (session.accessTokenId) d.submit(session.requestId, session.identifier, session.accessTokenId);
    else d.submit(session.requestId, session.identifier);
  });
}

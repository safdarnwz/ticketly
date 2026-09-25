import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],

    resolve: {
      alias: {
        '@': fileURLToPath(
          new URL('./src', import.meta.url),
        ),
      },
    },

    server: {
      // NOT the browser's hostname — this is which network interface the
      // dev-server SOCKET binds to, a completely separate concern from
      // "which subdomain do I type in the browser". Binding to 'app.localhost'
      // made Vite call getaddrinfo('app.localhost') to resolve a LISTEN
      // address, which Windows's OS-level resolver doesn't know how to
      // answer (browsers auto-resolve *.localhost → 127.0.0.1 per RFC 6761,
      // but that's a BROWSER behaviour, not something every OS network stack
      // implements — Windows in particular often doesn't). Binding to plain
      // 'localhost' listens on the loopback interface and accepts a
      // connection with ANY Host header — app.localhost, www.localhost,
      // app.<slug>.localhost — the backend's TenantResolutionMiddleware
      // reads that header itself; the dev-server never needs to know it.
      host: 'localhost',
      port: 5173,

      proxy: {
        '/api': {
          target:
            env.VITE_API_TARGET ||
            'http://localhost:3000',

          changeOrigin: true,
          // `changeOrigin: true` (needed so the backend accepts the proxied
          // connection at all) rewrites the Host header to the TARGET's host
          // (`localhost:3000`) — which would defeat the backend's Host-based
          // surface/tenant detection (TenantResolutionMiddleware) for every
          // request made through this dev server. Put the browser's ORIGINAL
          // Host back after proxying so `app.localhost`, `app.<slug>.localhost`
          // etc. still reach the backend as themselves.
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const originalHost = req.headers.host;
              if (originalHost) proxyReq.setHeader('host', originalHost);
            });
          },
        },
      },
    },
  };
});
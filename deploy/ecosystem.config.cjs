// PM2 process file — the alternative to systemd for the no-Docker deployment.
//   pm2 start deploy/ecosystem.config.cjs --env production
// PM2 cluster mode runs `instances` API processes across cores with a shared
// port (PM2's built-in load balancer); the worker runs as a single fork
// (scale it with `instances` too — FOR UPDATE SKIP LOCKED keeps them safe).
module.exports = {
  apps: [
    {
      name: 'yoobus-api',
      script: 'dist/apps/api/src/main.js',
      instances: 'max',        // one per CPU core
      exec_mode: 'cluster',
      max_memory_restart: '600M',
      kill_timeout: 30000,     // allow graceful drain
      wait_ready: false,
      env_production: { NODE_ENV: 'production' },
    },
    {
      name: 'yoobus-worker',
      script: 'dist/apps/worker/src/main.js',
      instances: 2,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      kill_timeout: 30000,
      env_production: { NODE_ENV: 'production', WORKER_ENABLED: 'true' },
    },
  ],
};

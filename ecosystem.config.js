/**
 * PM2 cluster mode: Node is single-threaded, so one process only ever uses
 * one CPU core. `instances: 'max'` tells PM2 to fork one worker per core and
 * load-balance incoming requests across them automatically (round-robin) —
 * this is the simplest form of load balancing, and enough for a single
 * beefy server. For scaling across multiple *machines*, see docker-compose.yml
 * + nginx instead (or put this whole cluster behind a cloud load balancer).
 */
module.exports = {
  apps: [
    {
      name: 'graha-backend',
      script: 'src/server.js',
      instances: 'max', // one worker per CPU core
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M', // restart a worker if it leaks past this
      autorestart: true,
      watch: false,
      // Gives in-flight requests time to finish during a rolling reload.
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};

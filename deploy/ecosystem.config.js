/**
 * PM2 Ecosystem — Kanoo Production
 * Hostinger VPS Ubuntu 22.04
 * 
 * Usage :
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save && pm2 startup
 */

module.exports = {
  apps: [
    // ── Application principale Next.js ──────────────────────────────────────
    {
      name: "kanoo",
      script: "node",
      args: "server.js",
      cwd: "/var/www/kanoo",

      // Instances (auto = nb de CPUs, 1 = single instance)
      instances: 1,
      exec_mode: "fork",

      // Redémarrage automatique
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,

      // Mémoire
      max_memory_restart: "512M",

      // Variables d'environnement production
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        // ⚠️  Ces valeurs sont chargées depuis /var/www/kanoo/.env.local
        // Ne jamais mettre les secrets ici en clair
      },

      // Logs
      log_file: "/var/log/pm2/kanoo.log",
      out_file: "/var/log/pm2/kanoo-out.log",
      error_file: "/var/log/pm2/kanoo-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },

    // ── Scheduler (cron jobs) ───────────────────────────────────────────────
    {
      name: "kanoo-scheduler",
      script: "scripts/scheduler.js",
      cwd: "/var/www/kanoo",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "128M",
      env_production: {
        NODE_ENV: "production",
      },
      log_file: "/var/log/pm2/kanoo-scheduler.log",
      out_file: "/var/log/pm2/kanoo-scheduler-out.log",
      error_file: "/var/log/pm2/kanoo-scheduler-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};

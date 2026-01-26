// ecosystem.config.cjs
require('dotenv').config(); // <-- подключаем dotenv

module.exports = {
  apps: [
    {
      name: 'altasales-backend',
      script: 'dist/main.js',
      cwd: '/var/www/altasales/altasales-api',
      instances: 1,
      autorestart: true,
      watch: false,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        PORT: process.env.PORT || 3548,
        NODE_ENV: process.env.NODE_ENV || 'production',
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_PORT: process.env.DB_PORT || 5432,
        DB_USER: process.env.DB_USER || 'altasales_user',
        DB_PASSWORD: process.env.DB_PASSWORD || 'maimchik002',
        DB_NAME: process.env.DB_NAME || 'altasales',
      },
    },
  ],
};

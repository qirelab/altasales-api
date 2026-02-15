require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'altasales-backend',
      script: 'dist/main.js',
      cwd: '/var/www/altasales/altasales-api',
      env: {
        PORT: process.env.PORT || 3548,
        NODE_ENV: process.env.NODE_ENV || 'production',

        DATABASE_URL: process.env.DATABASE_URL,
      },
    },
  ],
};

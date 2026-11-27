import { buildApp } from './app.js';
import { env } from './config.js';

const app = buildApp({
  databaseUrl: env.DATABASE_URL,
  logLevel: env.LOG_LEVEL,
  origin: env.WEB_ORIGIN,
  proxy: {
    internalHost: env.PROXY_INTERNAL_HOST,
    ips: env.TRUSTED_PROXY_IPS.split(',').map((ip) => ip.trim()),
  },
});
try {
  await app.listen({ port: env.API_PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

import pino from 'pino';
import { env } from './config.js';
import { startWorker } from './shared/jobs/index.js';

const log = pino({ level: env.LOG_LEVEL, redact: ['password', 'DATABASE_URL'] });
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
try {
  worker = await startWorker(env.DATABASE_URL, log);
  log.info({}, 'worker ready');
  const stop = async () => {
    await worker?.stop();
    process.exitCode = 0;
  };
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
} catch (error) {
  log.error({ err: error }, 'worker startup failed');
  process.exitCode = 1;
}

import pino from 'pino';
import { env } from './config.js';
import { startWorker } from './shared/jobs/index.js';

const log = pino({ level: env.LOG_LEVEL, redact: ['password', 'DATABASE_URL'] });
const shutdown = new AbortController();
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let stopping: Promise<void> | undefined;
const stop = () => {
  shutdown.abort();
  stopping ??= (async () => {
    await worker?.stop();
    process.exitCode = 0;
  })();
  return stopping;
};
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
try {
  worker = await startWorker(env.DATABASE_URL, log, { signal: shutdown.signal });
  if (shutdown.signal.aborted) await worker.stop();
} catch (error) {
  if (!shutdown.signal.aborted) {
    log.error({ err: error }, 'worker startup failed');
    process.exitCode = 1;
  }
}

import type { ProblemDetails } from '@arenahub/contracts';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { Pool } from 'pg';

export function buildApp(options: { databaseUrl: string; logLevel?: string }) {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'res.headers.set-cookie',
      ],
    },
    bodyLimit: 1_048_576,
    requestTimeout: 15_000,
    trustProxy: false,
  });
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
  });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  void app.register(helmet);
  app.get('/api/v1/health', async () => ({ status: 'ok' }));
  app.get('/api/v1/health/live', async () => ({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const statusCode =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const status = statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    const problem: ProblemDetails = {
      type:
        status === 500
          ? 'https://arenahub.app/errors/internal-error'
          : 'https://arenahub.app/errors/validation-failed',
      title: status === 500 ? 'Erro interno' : 'Requisição inválida',
      status,
      code: status === 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
      requestId: request.id,
    };
    reply.code(status).type('application/problem+json').send(problem);
  });
  return app;
}

import type { ProblemDetails } from '@arenahub/contracts';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import nodemailer from 'nodemailer';
import { Pool } from 'pg';
import { ZodError } from 'zod';
import { AccessError } from './identity/core.js';
import { authRoutes, type Delivery } from './identity/session.js';
import { teamRoutes } from './identity/team.js';
import { IdempotencyError } from './shared/idempotency/index.js';

export function buildApp(options: {
  databaseUrl: string;
  logLevel?: string;
  origin?: string;
  deliver?: Delivery;
}) {
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
    application_name: 'arenahub-api-readiness',
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
  });
  pool.on('error', (error: Error & { code?: string }) => {
    app.log.error({ code: error.code }, 'idle PostgreSQL readiness connection failed');
  });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  void app.register(helmet);
  const origin = options.origin ?? 'http://localhost:3000';
  const deliver: Delivery =
    options.deliver ??
    (async (email, kind, secret) => {
      const smtp = process.env.SMTP_URL;
      if (!smtp && process.env.NODE_ENV === 'production') throw Error('SMTP indisponível');
      const transport = nodemailer.createTransport(smtp ?? 'smtp://localhost:1025');
      await transport.sendMail({
        from: process.env.MAIL_FROM ?? 'ArenaHub <acesso@localhost>',
        to: email,
        subject: kind === 'invite' ? 'Convite para a arena' : 'Recuperação da conta',
        text: origin + '/#' + kind + '=' + secret,
      });
    });
  void app.register(
    async (identity) => {
      identity.addHook('onSend', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
      });
      await authRoutes(identity, pool, { origin, deliver });
      teamRoutes(identity, pool, { origin, deliver });
    },
    { prefix: '/api/v1' },
  );
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
    const expected = error instanceof AccessError || error instanceof ZodError;
    if (!expected)
      request.log.error(
        { code: typeof error === 'object' && error && 'code' in error ? error.code : undefined },
        'request failed',
      );
    const statusCode =
      error instanceof ZodError
        ? 400
        : (error as { code?: string })?.code === '23505'
          ? 409
          : error instanceof IdempotencyError
            ? error.code === 'VALIDATION_FAILED'
              ? 400
              : 409
            : error instanceof Error &&
                'statusCode' in error &&
                typeof error.statusCode === 'number'
              ? error.statusCode
              : 500;
    const status = statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    const code =
      error instanceof AccessError || error instanceof IdempotencyError
        ? error.code
        : status === 429
          ? 'RATE_LIMITED'
          : status === 409
            ? 'INVALID_TRANSITION'
            : status === 500
              ? 'INTERNAL_ERROR'
              : 'VALIDATION_FAILED';
    const problem: ProblemDetails = {
      type: 'https://arenahub.app/errors/' + code.toLowerCase().replaceAll('_', '-'),
      title:
        status === 500
          ? 'Erro interno'
          : status === 401
            ? 'Autenticação necessária'
            : status === 403
              ? 'Acesso negado'
              : status === 404
                ? 'Recurso indisponível'
                : 'Requisição recusada',
      status,
      code,
      requestId: request.id,
    };
    if (error instanceof IdempotencyError && error.retryAfterSeconds) {
      reply.header('Retry-After', String(error.retryAfterSeconds));
    }
    reply.code(status).type('application/problem+json').send(problem);
  });
  return app;
}

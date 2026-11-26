import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { env } from './config.js';

const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] } });

await app.register(helmet);

app.get('/api/v1/health', async () => ({ status: 'ok' }));

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const statusCode = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode : 500;
  const status = statusCode < 500 ? statusCode : 500;
  reply.code(status).type('application/problem+json').send({
    type: 'https://arenahub.app/errors/internal-error',
    title: status === 500 ? 'Erro interno' : 'Requisição inválida',
    status,
    code: status === 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
    requestId: request.id,
    errors: []
  });
});

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}


import { ProblemDetailsSchema } from '@arenahub/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { IdempotencyError } from './shared/idempotency/index.js';

describe('health HTTP', () => {
  it('separa liveness e readiness quando PostgreSQL está indisponível', async () => {
    const app = buildApp({
      databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
      logLevel: 'silent',
    });
    try {
      const live = await app.inject('/api/v1/health/live');
      expect(live.statusCode).toBe(200);
      expect((await app.inject('/api/v1/health')).statusCode).toBe(200);
      const ready = await app.inject('/api/v1/health/ready');
      expect(ready.statusCode).toBe(503);
      expect(ready.body).not.toContain('unused');
    } finally {
      await app.close();
    }
  });

  it('serializa erro inesperado como Problem Details sem expor detalhes', async () => {
    const app = buildApp({
      databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
      logLevel: 'silent',
    });
    app.get('/synthetic-error', async () => {
      throw new Error('segredo-interno');
    });
    try {
      const response = await app.inject('/synthetic-error');
      expect(response.statusCode).toBe(500);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(ProblemDetailsSchema.parse(response.json())).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(response.body).not.toContain('segredo-interno');
    } finally {
      await app.close();
    }
  });

  it('mapeia disputa idempotente para 409 com Retry-After', async () => {
    const app = buildApp({
      databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
      logLevel: 'silent',
    });
    app.post('/synthetic-idempotency', async () => {
      throw new IdempotencyError('IDEMPOTENCY_IN_PROGRESS');
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/synthetic-idempotency' });
      expect(response.statusCode).toBe(409);
      expect(response.headers['retry-after']).toBe('1');
      expect(ProblemDetailsSchema.parse(response.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS');
    } finally {
      await app.close();
    }
  });
});

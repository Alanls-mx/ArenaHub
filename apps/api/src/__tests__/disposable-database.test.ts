import { afterEach, describe, expect, it } from 'vitest';
import { parseDisposableDatabaseUrl, requireDisposableDatabase } from './disposable-database.js';

const originalUrl = process.env.TEST_DATABASE_URL;
const originalToken = process.env.ARENAHUB_TEST_DB_TOKEN;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = originalUrl;
  if (originalToken === undefined) delete process.env.ARENAHUB_TEST_DB_TOKEN;
  else process.env.ARENAHUB_TEST_DB_TOKEN = originalToken;
});

describe('proteção do banco descartável', () => {
  it.each([
    'postgresql://arenahub:secret@localhost:5432/arenahub',
    'postgresql://arenahub_test:secret@db.example.com:5432/arenahub_test_0123456789abcdef',
    'postgresql://arenahub_test:secret@localhost:5432/production',
    'postgresql://arenahub_test:secret@localhost:5432/arenahub_test_0123456789abcdef?schema=public',
  ])('recusa origem não comprovada: %s', (url) => {
    expect(() => parseDisposableDatabaseUrl(url)).toThrow(/descartável inválido/);
  });

  it('aceita apenas o formato de URL gerado pelo runner', () => {
    const parsed = parseDisposableDatabaseUrl(
      'postgresql://arenahub_test:secret@127.0.0.1:5432/arenahub_test_0123456789abcdef',
    );
    expect(parsed.pathname).toBe('/arenahub_test_0123456789abcdef');
  });

  it('não faz fallback para DATABASE_URL sem configuração do runner', async () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.ARENAHUB_TEST_DB_TOKEN;
    await expect(requireDisposableDatabase()).rejects.toThrow(/requer Testcontainers/);
  });
});

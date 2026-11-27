import { Client } from 'pg';

const databaseName = /^arenahub_test_[a-f0-9]{16}$/;
const tokenPattern = /^[a-f0-9]{32}$/;

export function parseDisposableDatabaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username !== 'arenahub_test' ||
    !databaseName.test(url.pathname.slice(1)) ||
    url.search ||
    url.hash
  ) {
    throw new Error('Banco de teste descartável inválido; conexão recusada');
  }
  return url;
}

export async function assertDisposableDatabase(urlValue: string, token: string): Promise<void> {
  const url = parseDisposableDatabaseUrl(urlValue);
  if (!tokenPattern.test(token))
    throw new Error('Marcador do banco descartável ausente ou inválido');
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ token: string }>(
      'SELECT token FROM public.arena_test_marker WHERE id = 1',
    );
    if (result.rows[0]?.token !== token)
      throw new Error('Marcador do banco descartável divergente');
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function requireDisposableDatabase(): Promise<string> {
  const url = process.env.TEST_DATABASE_URL;
  const token = process.env.ARENAHUB_TEST_DB_TOKEN;
  if (!url || !token)
    throw new Error('Teste de integração requer Testcontainers; use pnpm test:integration');
  await assertDisposableDatabase(url, token);
  return url;
}

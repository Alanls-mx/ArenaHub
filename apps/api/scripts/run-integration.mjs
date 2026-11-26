import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

const image = 'postgres:16@sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8';
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('Execute o runner pelo script pnpm test:integration');

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} falhou (${code})`)),
    );
  });
}

async function main() {
  if (process.env.TEST_DATABASE_URL || process.env.ARENAHUB_TEST_DB_TOKEN) {
    throw new Error(
      'Remova TEST_DATABASE_URL e ARENAHUB_TEST_DB_TOKEN herdados; o runner cria seu próprio banco',
    );
  }
  const nonce = randomBytes(8).toString('hex');
  const token = randomBytes(16).toString('hex');
  const password = randomBytes(24).toString('hex');
  const container = await new PostgreSqlContainer(image)
    .withDatabase(`arenahub_test_${nonce}`)
    .withUsername('arenahub_test')
    .withPassword(password)
    .withStartupTimeout(120_000)
    .start();
  try {
    const url = container.getConnectionUri();
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query(
        'CREATE TABLE public.arena_test_marker (id integer PRIMARY KEY CHECK (id = 1), token text NOT NULL)',
      );
      await client.query('INSERT INTO public.arena_test_marker (id, token) VALUES (1, $1)', [
        token,
      ]);
    } finally {
      await client.end().catch(() => undefined);
    }
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      ARENAHUB_DB_TARGET: 'test',
      TEST_DATABASE_URL: url,
      ARENAHUB_TEST_DB_TOKEN: token,
    };
    delete env.DATABASE_URL;
    await run(process.execPath, [pnpmCli, 'exec', 'prisma', 'migrate', 'deploy'], env);
    await run(
      process.execPath,
      [
        pnpmCli,
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      env,
    );
    await run(process.execPath, ['scripts/check-schema.mjs'], env);
    await run(
      process.execPath,
      [pnpmCli, 'exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
      env,
    );
  } finally {
    await container.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

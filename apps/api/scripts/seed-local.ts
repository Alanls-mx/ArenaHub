import { passwordSchema } from '@arenahub/contracts';
import { Pool } from 'pg';
import { z } from 'zod';
import { seedLocalOrganizations } from '../src/identity/provision.js';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/arenahub' ||
  url.username !== 'arenahub'
)
  throw Error('O seed requer o banco de desenvolvimento local.');
const pool = new Pool({ connectionString: url.toString() });
try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const { password } = z.strictObject({ password: passwordSchema }).parse(JSON.parse(raw));
  await seedLocalOrganizations(pool, password);
  console.log('Duas arenas locais disponíveis para equipe@example.org.');
} catch {
  console.error('Falha no seed local. Confira a entrada e se os slugs já estão em uso.');
  process.exitCode = 1;
} finally {
  await pool.end();
}

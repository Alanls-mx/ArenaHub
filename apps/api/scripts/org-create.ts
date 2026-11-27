import { Pool } from 'pg';
import { provision } from '../src/identity/provision.js';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  await provision(pool, JSON.parse(input));
  console.log('Organização provisionada');
} catch {
  console.error('Falha no provisionamento. Confira os dados e a conexão.');
  process.exitCode = 1;
} finally {
  await pool.end();
}

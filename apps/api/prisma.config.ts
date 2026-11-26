import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

dotenv.config({ path: '../../.env' });

const target = process.env.ARENAHUB_DB_TARGET ?? 'development';
if (target !== 'development' && target !== 'test') {
  throw new Error('ARENAHUB_DB_TARGET deve ser development ou test');
}
const connectionString = target === 'test' ? env('TEST_DATABASE_URL') : env('DATABASE_URL');
const spikeUrl = new URL(connectionString);
const localHost = ['localhost', '127.0.0.1'].includes(spikeUrl.hostname);
if (!localHost || !['postgres:', 'postgresql:'].includes(spikeUrl.protocol)) {
  throw new Error('Migrations do spike só podem acessar PostgreSQL local');
}
if (
  target === 'development' &&
  (spikeUrl.pathname !== '/arenahub' || spikeUrl.username !== 'arenahub')
) {
  throw new Error('Banco de desenvolvimento do spike inválido');
}
if (
  target === 'test' &&
  (!/^\/arenahub_test_[a-f0-9]{16}$/.test(spikeUrl.pathname) ||
    spikeUrl.username !== 'arenahub_test' ||
    !/^[a-f0-9]{32}$/.test(process.env.ARENAHUB_TEST_DB_TOKEN ?? ''))
) {
  throw new Error('Teste do spike exige banco e marcador criados pelo runner');
}
spikeUrl.searchParams.set('schema', 'occupancy_spike');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: spikeUrl.toString() },
});

import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

dotenv.config({ path: '../../.env' });

const spikeUrl = new URL(env('DATABASE_URL'));
spikeUrl.searchParams.set('schema', 'occupancy_spike');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: spikeUrl.toString() }
});


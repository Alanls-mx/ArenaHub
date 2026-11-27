import { defineConfig } from 'prisma/config';
import local from './prisma.config.js';
const url = new URL(local.datasource!.url!);
url.searchParams.set('schema', 'arena_identity');
export default defineConfig({
  schema: 'prisma/identity.prisma',
  datasource: { url: url.toString() },
});

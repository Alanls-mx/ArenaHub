import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  PROXY_INTERNAL_HOST: z.string().min(1).default('127.0.0.1:3001'),
  TRUSTED_PROXY_IPS: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().url(),
});

export const env = EnvSchema.parse(process.env);

import { createHash, randomUUID } from 'node:crypto';
import { IdempotencyKeySchema } from '@arenahub/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

const uuid = z.uuid();
export function requireIdempotencyKey(value: unknown): string {
  const result = IdempotencyKeySchema.safeParse(value);
  if (!result.success) throw new IdempotencyError('VALIDATION_FAILED');
  return result.data;
}
export type IdempotencyInput = {
  organizationId: string;
  userId: string;
  key: string;
  method: string;
  route: string;
  pathParams: Record<string, string>;
  body: unknown;
};
export type StoredResponse = { status: number; body: unknown };

export class IdempotencyError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS',
  ) {
    super(code);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new IdempotencyError('VALIDATION_FAILED');
  return encoded;
}

export function requestHash(
  input: Pick<IdempotencyInput, 'body' | 'method' | 'route' | 'pathParams'>,
): string {
  return createHash('sha256')
    .update(
      canonical({
        method: input.method.toUpperCase(),
        route: input.route,
        pathParams: input.pathParams,
        body: input.body,
      }),
    )
    .digest('hex');
}

export async function executeIdempotent(
  pool: Pool,
  input: IdempotencyInput,
  effect: (client: PoolClient) => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const parsed = z
    .object({
      organizationId: uuid,
      userId: uuid,
      key: IdempotencyKeySchema,
      method: z.string().min(1),
      route: z.string().startsWith('/'),
      pathParams: z.record(z.string(), z.string()),
    })
    .safeParse(input);
  if (!parsed.success) throw new IdempotencyError('VALIDATION_FAILED');
  const hash = requestHash(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    const inserted = await client.query(
      `INSERT INTO occupancy_spike.idempotency_records
       (id, organization_id, user_id, key, method, route, path_params, request_hash,
        response_status, response_body, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,200,'{}'::jsonb,now() + interval '24 hours')
       ON CONFLICT (organization_id, user_id, key) DO NOTHING RETURNING id`,
      [
        randomUUID(),
        input.organizationId,
        input.userId,
        input.key,
        input.method.toUpperCase(),
        input.route,
        canonical(input.pathParams),
        hash,
      ],
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query<{
        method: string;
        route: string;
        path_params: unknown;
        request_hash: string;
        response_status: number;
        response_body: unknown;
        expires_at: Date;
      }>(
        `SELECT method, route, path_params, request_hash, response_status, response_body, expires_at
         FROM occupancy_spike.idempotency_records
         WHERE organization_id=$1 AND user_id=$2 AND key=$3 FOR UPDATE`,
        [input.organizationId, input.userId, input.key],
      );
      const row = existing.rows[0];
      if (
        !row ||
        row.expires_at <= new Date() ||
        row.request_hash !== hash ||
        row.method !== input.method.toUpperCase() ||
        row.route !== input.route ||
        canonical(row.path_params) !== canonical(input.pathParams)
      ) {
        throw new IdempotencyError('IDEMPOTENCY_KEY_REUSED');
      }
      await client.query('COMMIT');
      return { status: row.response_status, body: row.response_body };
    }
    const response = await effect(client);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 499) {
      throw new IdempotencyError('VALIDATION_FAILED');
    }
    const body = canonical(response.body);
    await client.query(
      `UPDATE occupancy_spike.idempotency_records SET response_status=$1, response_body=$2::jsonb
       WHERE id=$3`,
      [response.status, body, inserted.rows[0].id],
    );
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof Error && 'code' in error && error.code === '55P03') {
      throw new IdempotencyError('IDEMPOTENCY_IN_PROGRESS');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanExpiredIdempotency(pool: Pool): Promise<number> {
  const result = await pool.query(
    'DELETE FROM occupancy_spike.idempotency_records WHERE expires_at < now()',
  );
  return result.rowCount ?? 0;
}

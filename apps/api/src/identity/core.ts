import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ErrorCode } from '@arenahub/contracts';
import type { Pool, PoolClient } from 'pg';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export class AccessError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
  ) {
    super(code);
  }
}
export function deny(status: 400 | 401 | 403 | 404 | 409 | 429): never {
  throw new AccessError(
    status,
    (
      {
        400: 'VALIDATION_FAILED',
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'INVALID_TRANSITION',
        429: 'RATE_LIMITED',
      } as const
    )[status] ?? 'INTERNAL_ERROR',
  );
}
function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    argon2(
      'argon2id',
      { message: password, nonce: salt, parallelism: 1, tagLength: 32, memory: 19456, passes: 2 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}
export async function encodePassword(password: string) {
  const salt = randomBytes(16);
  return ['a2id-v1', salt.toString('hex'), (await derive(password, salt)).toString('hex')].join(
    '$',
  );
}
export async function matches(password: string, encoded?: string) {
  const [, salt, digest] = (encoded ?? '').split('$');
  const value = await derive(password, Buffer.from(salt ?? '00'.repeat(16), 'hex'));
  return !!digest && timingSafeEqual(value, Buffer.from(digest, 'hex'));
}
export async function transaction<T>(pool: Pool, work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL search_path TO arena_identity,pg_catalog');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function audit(
  db: PoolClient,
  actor: string,
  org: string | null,
  action: string,
  entity: string,
  requestId: string,
) {
  await db.query(
    'INSERT INTO audit_logs(actor_id,organization_id,action,entity,request_id) VALUES($1,$2,$3,$4,$5)',
    [actor, org, action, entity, requestId],
  );
}

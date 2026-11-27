import { emailSchema, passwordSchema, templates } from '@arenahub/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { audit, encodePassword, transaction } from './core.js';
import { isReservedSlug } from './host.js';
async function createOrganization(db: PoolClient, input: unknown) {
  const data = z
    .strictObject({
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(63),
      name: z.string().trim().min(1).max(120),
      email: emailSchema,
      password: passwordSchema,
      ownerName: z.string().min(1).max(120),
    })
    .parse(input);
  if (isReservedSlug(data.slug)) throw new Error('Slug reservado');

  await db.query(
    'INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',
    [data.email, data.ownerName, await encodePassword(data.password)],
  );
  const user = (
    await db.query('SELECT id FROM users WHERE email=$1 AND disabled_at IS NULL FOR SHARE', [
      data.email,
    ])
  ).rows[0];
  if (!user) throw Error('Conta indisponível');
  const org = (
    await db.query('INSERT INTO organizations(slug,name) VALUES($1,$2) RETURNING id', [
      data.slug,
      data.name,
    ])
  ).rows[0];
  await db.query('INSERT INTO memberships(organization_id,user_id,is_owner) VALUES($1,$2,true)', [
    org.id,
    user.id,
  ]);
  for (const [name, codes] of Object.entries(templates)) {
    const role = (
      await db.query('INSERT INTO roles(organization_id,name) VALUES($1,$2) RETURNING id', [
        org.id,
        name,
      ])
    ).rows[0];
    await db.query('INSERT INTO role_permissions SELECT $1,$2,unnest($3::text[])', [
      org.id,
      role.id,
      codes,
    ]);
  }
  await audit(db, user.id, org.id, 'organization.provisioned', org.id, 'org:create');
  return org.id as string;
}
export function provision(pool: Pool, input: unknown) {
  return transaction(pool, (db) => createOrganization(db, input));
}
export function seedLocalOrganizations(pool: Pool, password: string) {
  return transaction(pool, async (db) => {
    const email = 'equipe@example.org';
    for (const [slug, name] of [
      ['arena-leste', 'Arena Leste'],
      ['arena-sul', 'Arena Sul'],
    ] as const) {
      const existing = await db.query('SELECT id FROM organizations WHERE slug=$1', [slug]);
      if (existing.rowCount) {
        const owner = await db.query(
          "SELECT 1 FROM memberships m JOIN users u ON m.user_id=u.id WHERE organization_id=$1 AND is_owner AND status='active' AND u.email=$2",
          [existing.rows[0].id, email],
        );
        if (!owner.rowCount) throw Error('Slug ocupado');
        continue;
      }
      await createOrganization(db, { email, password, slug, name, ownerName: 'Conta de teste' });
    }
  });
}

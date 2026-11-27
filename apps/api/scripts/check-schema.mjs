import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: '../../.env' });
const target = process.env.ARENAHUB_DB_TARGET ?? 'development';
const url = target === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL do alvo selecionado ausente');
const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });

function requireMatch(value, pattern, label) {
  if (!pattern.test(value ?? '')) throw new Error(`Garantia SQL ausente ou alterada: ${label}`);
}

try {
  await client.connect();
  const extensions = await client.query(
    "SELECT extname FROM pg_extension WHERE extname='btree_gist'",
  );
  if (extensions.rowCount !== 1) throw new Error('Garantia SQL ausente: btree_gist');
  const constraints = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE connamespace='occupancy_spike'::regnamespace`);
  const definition = (name) => constraints.rows.find((row) => row.conname === name)?.definition;
  requireMatch(
    definition('schedule_no_overlap'),
    /EXCLUDE USING gist \(unit_id WITH =, period WITH &&\).*WHERE \(active\)/,
    'exclusion parcial de ocupação',
  );
  requireMatch(
    definition('schedule_occupancies_valid_interval'),
    /end_at > start_at/,
    'intervalo positivo',
  );
  requireMatch(
    definition('schedule_occupancies_organization_id_unit_id_fkey'),
    /FOREIGN KEY \(organization_id, unit_id\).*REFERENCES .*schedule_units\(organization_id, id\)/,
    'FK tenant composta',
  );
  requireMatch(
    definition('idempotency_expiry_check'),
    /expires_at > created_at/,
    'expiração de idempotência',
  );
  const column = await client.query(`
    SELECT a.attgenerated, format_type(a.atttypid, a.atttypmod) AS type,
           pg_get_expr(d.adbin, d.adrelid) AS expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='occupancy_spike' AND c.relname='schedule_occupancies' AND a.attname='period'`);
  if (column.rows[0]?.attgenerated !== 's' || column.rows[0]?.type !== 'tstzrange') {
    throw new Error('Garantia SQL ausente: período tstzrange gerado');
  }
  requireMatch(
    column.rows[0]?.expression,
    /tstzrange\(start_at, end_at, '\[\)'/,
    'período semiaberto',
  );
  const foreignKeys = await client.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='arena_identity.membership_roles'::regclass AND contype='f'",
  );
  for (const fields of ['organization_id, user_id', 'organization_id, role_id']) {
    if (!foreignKeys.rows.some((row) => row.definition.startsWith('FOREIGN KEY (' + fields + ')')))
      throw Error('FK de atribuição ausente');
  }
  const catalog = await client.query('SELECT code FROM arena_identity.permissions ORDER BY code');
  const { permissionCodes } = await import('@arenahub/contracts');
  if (catalog.rows.map((r) => r.code).join() !== [...permissionCodes].sort().join())
    throw Error('Catálogo de capabilities divergente');
  const guards = await client.query(`
    SELECT tgname, tgdeferrable, pg_get_triggerdef(oid) AS definition
    FROM pg_trigger WHERE tgrelid IN (
      'arena_identity.organizations'::regclass,
      'arena_identity.memberships'::regclass,
      'arena_identity.users'::regclass,
      'arena_identity.audit_logs'::regclass
    ) AND NOT tgisinternal`);
  for (const name of ['organization_owner', 'membership_owner', 'account_owner']) {
    const guard = guards.rows.find((row) => row.tgname === name);
    if (!guard?.tgdeferrable || !guard.definition.includes('check_owner_change'))
      throw Error(`Garantia SQL ausente: ${name}`);
  }
  if (
    !guards.rows.some(
      (row) => row.tgname === 'audit_append_only' && row.definition.includes('preserve_audit'),
    )
  )
    throw Error('Proteção SQL de auditoria ausente');
  const domains = await client.query(`
    SELECT indexdef FROM pg_indexes WHERE schemaname='arena_identity'
      AND tablename='organization_domains'`);
  if (!domains.rows.some((row) => /UNIQUE INDEX.*\(hostname\)/.test(row.indexdef)))
    throw Error('Unicidade global de hostname ausente');
  const domainChecks = await client.query(`
    SELECT conrelid::regclass::text AS table_name, contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid IN (
      'arena_identity.organizations'::regclass,
      'arena_identity.organization_domains'::regclass
    )`);
  const has = (table, type, pattern) =>
    domainChecks.rows.some(
      (row) => row.table_name === table && row.contype === type && pattern.test(row.definition),
    );
  if (!has('arena_identity.organizations', 'c', /length\(slug\) <= 63.*slug/))
    throw Error('Garantia SQL de slug seguro ausente');
  if (!has('arena_identity.organization_domains', 'f', /FOREIGN KEY \(organization_id\)/))
    throw Error('FK de domínio ausente');
  if (!has('arena_identity.organization_domains', 'c', /hostname = lower\(hostname\)/))
    throw Error('Normalização SQL de hostname ausente');
  if (!has('arena_identity.organization_domains', 'c', /status.*active.*activated_at/))
    throw Error('Estado de ativação de domínio sem CHECK');
  console.log('Garantias SQL de ocupação, identidade e domínios verificadas.');
} finally {
  await client.end().catch(() => undefined);
}

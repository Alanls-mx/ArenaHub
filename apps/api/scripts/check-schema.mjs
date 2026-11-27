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
  console.log('Garantias SQL do schema experimental verificadas.');
} finally {
  await client.end().catch(() => undefined);
}

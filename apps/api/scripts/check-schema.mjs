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
  const operational = await client.query(`
    SELECT conrelid::regclass::text AS table_name, conname, contype,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE connamespace='arena_identity'::regnamespace`);
  const check = (table, type, pattern, label) => {
    if (
      !operational.rows.some(
        (r) =>
          r.table_name === `arena_identity.${table}` &&
          r.contype === type &&
          pattern.test(r.definition),
      )
    )
      throw Error(`Garantia SQL operacional ausente: ${label}`);
  };
  for (const [table, parent] of [
    ['venue_unit_links', 'venues'],
    ['venue_unit_links', 'venue_units'],
    ['venue_sports', 'venues'],
    ['venue_sports', 'sports'],
    ['operating_hours', 'venues'],
    ['calendar_exceptions', 'venues'],
    ['pricing_rules', 'venues'],
    ['pricing_rules', 'sports'],
  ])
    check(
      table,
      'f',
      new RegExp(
        `FOREIGN KEY \\(organization_id, (?:venue_id|unit_id|sport_id)\\) REFERENCES (?:arena_identity\\.)?${parent}\\(organization_id, id\\)`,
      ),
      `${table} → ${parent}`,
    );
  check(
    'calendar_exceptions',
    'u',
    /UNIQUE NULLS NOT DISTINCT \(organization_id, venue_id, date\)/,
    'unicidade de exceção global',
  );
  check('pricing_rules', 'c', /start_minute < end_minute/, 'intervalo de preço');
  check('pricing_rules', 'c', /price_per_hour_cents.*9007199254740991/, 'centavos seguros');
  check('pricing_rules', 'c', /specific_date IS NOT NULL.*weekday IS NULL/, 'escopo de preço');
  check('operating_hours', 'c', /open_time = close_time.*spans_full_day/, 'horário contínuo');
  const customerIndexes = await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='arena_identity' AND tablename='customers'",
  );
  if (!customerIndexes.rows.some((r) => r.indexname === 'customers_phone'))
    throw Error('Índice de telefone por arena ausente');
  const triggers = await client.query(`SELECT tgname,tgdeferrable FROM pg_trigger
    WHERE tgrelid IN ('arena_identity.venues'::regclass,'arena_identity.venue_unit_links'::regclass,'arena_identity.venue_units'::regclass)
    AND NOT tgisinternal`);
  for (const name of ['venue_composition_guard', 'venue_links_guard', 'venue_unit_archive_guard'])
    if (!triggers.rows.some((r) => r.tgname === name && r.tgdeferrable))
      throw Error(`Garantia SQL operacional ausente: ${name}`);
  const compositionFunction = await client.query(
    "SELECT proconfig FROM pg_proc WHERE pronamespace='arena_identity'::regnamespace AND proname='ensure_venue_composition'",
  );
  if (
    !compositionFunction.rows[0]?.proconfig?.some(
      (x) => x.replaceAll(' ', '') === 'search_path=arena_identity,pg_catalog',
    )
  )
    throw Error('Trigger de composição sem search_path fixo');
  check(
    'schedule_occupancies',
    'x',
    /EXCLUDE USING gist.*organization_id WITH =.*unit_id WITH =.*period WITH &&.*WHERE \(active\)/,
    'exclusão física definitiva por arena e unidade',
  );
  check('schedule_occupancies', 'c', /end_at > start_at/, 'intervalo físico positivo');
  check(
    'schedule_occupancies',
    'c',
    /num_nonnulls\(reservation_id, block_id\) = 1/,
    'origem única de ocupação',
  );
  for (const [column, target] of [
    ['unit_id', 'venue_units'],
    ['reservation_id', 'reservations'],
    ['block_id', 'venue_blocks'],
  ])
    check(
      'schedule_occupancies',
      'f',
      new RegExp(
        `FOREIGN KEY \\(organization_id, ${column}\\) REFERENCES (?:arena_identity\\.)?${target}\\(organization_id, id\\)`,
      ),
      `ocupação → ${target}`,
    );
  check(
    'recurrences',
    'x',
    /EXCLUDE USING gist.*organization_id WITH =.*contract_id WITH =.*daterange.*WITH &&/,
    'vigência exclusiva de versões',
  );
  for (const [table, column, parent] of [
    ['reservations', 'customer_id', 'customers'],
    ['reservations', 'venue_id', 'venues'],
    ['reservations', 'recurrence_id', 'recurrences'],
    ['venue_blocks', 'venue_id', 'venues'],
    ['recurrences', 'contract_id', 'recurrence_contracts'],
    ['recurrence_exceptions', 'recurrence_id', 'recurrences'],
    ['reservation_history', 'reservation_id', 'reservations'],
    ['recurrence_rules', 'recurrence_id', 'recurrences'],
  ])
    check(
      table,
      'f',
      new RegExp(
        `FOREIGN KEY \\(organization_id, ${column}\\) REFERENCES (?:arena_identity\\.)?${parent}\\(organization_id, id\\)`,
      ),
      `${table} → ${parent}`,
    );
  check(
    'reservation_payment_confirmations',
    'f',
    /FOREIGN KEY \(organization_id, customer_id, reservation_id\) REFERENCES (?:arena_identity\.)?reservations\(organization_id, customer_id, id\)/,
    'prova financeira ligada ao cliente da reserva',
  );
  check(
    'recurrence_rules',
    'u',
    /UNIQUE \(organization_id, recurrence_id, weekday\)/,
    'uma regra semanal por dia',
  );
  check(
    'reservation_commercial_outcomes',
    'c',
    /amount_cents.*9007199254740991/,
    'resultado comercial em centavos',
  );
  const commercialIndexes = await client.query(
    "SELECT indexdef FROM pg_indexes WHERE schemaname='arena_identity' AND tablename='reservation_commercial_outcomes'",
  );
  if (
    !commercialIndexes.rows.some((r) =>
      /UNIQUE INDEX reservation_terminal_outcome.*\(organization_id, reservation_id, kind\).*WHERE.*CANCELLATION.*NO_SHOW/.test(
        r.indexdef,
      ),
    )
  )
    throw Error('Unicidade de resultados terminais ausente');
  const finalPeriod =
    await client.query(`SELECT a.attgenerated,format_type(a.atttypid,a.atttypmod) AS type,
    pg_get_expr(d.adbin,d.adrelid) AS expression FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='arena_identity' AND c.relname='schedule_occupancies' AND a.attname='period'`);
  if (finalPeriod.rows[0]?.attgenerated !== 's' || finalPeriod.rows[0]?.type !== 'tstzrange')
    throw Error('Período definitivo não é range gerado');
  requireMatch(
    finalPeriod.rows[0]?.expression,
    /tstzrange\(start_at, end_at, '\[\)'/,
    'range definitivo semiaberto',
  );
  console.log('Garantias SQL de ocupação, identidade, domínios, estrutura e agenda verificadas.');
} finally {
  await client.end().catch(() => undefined);
}

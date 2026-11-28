import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { chromium, type WebSocket as BrowserWebSocket } from 'playwright-core';
import prettier from 'prettier';
import { requireDisposableDatabase } from '../src/__tests__/disposable-database.js';
import { buildApp } from '../src/app.js';
import { provision } from '../src/identity/provision.js';

const db = await requireDisposableDatabase();
const pool = new Pool({ connectionString: db });
const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
const next = createRequire(webDir + 'package.json')('next')({ dev: false, dir: webDir });
const server = createServer(next.getRequestHandler());
const origin = 'http://localhost:34873';
const app = buildApp({
  databaseUrl: db,
  origin,
  logLevel: 'silent',
  proxy: { internalHost: '127.0.0.1:3001', ips: ['127.0.0.1'] },
});
const evidence = fileURLToPath(new URL('../../../docs/evidence/phase4/', import.meta.url));
const slug = 'arena-fase4',
  email = 'owner-fase4@example.org',
  password = randomUUID();
const date = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
let browser;
const started = Date.now();
try {
  await mkdir(evidence, { recursive: true });
  await provision(pool, { slug, name: 'Arena de teste', ownerName: 'Owner', email, password });
  await next.prepare();
  await app.listen({ port: 3001, host: '127.0.0.1' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(34873, 'localhost', resolve);
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const csrf = (
    await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { origin, cookie } })
  ).json().csrf as string;
  async function api(method: 'POST' | 'PUT', path: string, payload: unknown) {
    const response = await app.inject({
      method,
      url: `/api/v1/orgs/${slug}${path}`,
      headers: { origin, cookie, 'x-csrf-token': csrf },
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  }
  const sport = (await api('POST', '/sports', { name: 'Futebol' })).id;
  const unitA = (await api('POST', '/units', { name: 'Metade A' })).id;
  const unitB = (await api('POST', '/units', { name: 'Metade B' })).id;
  const customer = (
    await api('POST', '/customers', { name: 'Cliente Fictício', phone: null, email: null })
  ).id;
  const createVenue = async (name: string, unitIds: string[]) =>
    (
      await api('POST', '/venues', {
        name,
        unitIds,
        sportIds: [sport],
        defaultPricePerHourCents: 8000,
        color: '#198a71',
        sortOrder: 0,
      })
    ).id as string;
  const a = await createVenue('Campo A', [unitA]);
  const b = await createVenue('Campo B', [unitB]);
  const full = await createVenue('Campo completo', [unitA, unitB]);
  for (const id of [a, b, full])
    await api('PUT', `/venues/${id}/operating-hours`, {
      shifts: [{ weekday, openTime: '06:00', closeTime: '23:00', spansFullDay: false }],
    });

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p1 = await first.newPage(),
    p2 = await second.newPage();
  let secondSocket: BrowserWebSocket | undefined;
  p2.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === `/api/v1/orgs/${slug}/agenda/stream`)
      secondSocket = socket;
  });
  const errors: string[] = [];
  const rateLimited: string[] = [];
  const traffic = new Map<string, number>();
  p1.on('pageerror', (error) => errors.push(error.message));
  p2.on('pageerror', (error) => errors.push(error.message));
  for (const page of [p1, p2])
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      traffic.set(path, (traffic.get(path) ?? 0) + 1);
      if (response.status() === 429) rateLimited.push(path);
    });
  async function signIn(page: typeof p1) {
    await page.goto(origin);
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('heading', { name: 'Agenda da arena' }).waitFor();
    await page.getByText('Ao vivo').waitFor({ timeout: 10_000 });
    await page.getByLabel('Data inicial').fill(date);
  }
  await signIn(p1);
  await signIn(p2);
  assert(secondSocket, 'Segundo contexto não abriu WebSocket real');
  const form = p1.getByRole('heading', { name: 'Nova reserva' }).locator('..').locator('form');
  await form.getByLabel('Espaço').selectOption(full);
  await form.getByLabel('Cliente').selectOption(customer);
  await form.getByLabel('Modalidade').selectOption(sport);
  await form.getByLabel('Início').fill('18:00');
  await form.getByText('Disponível').waitFor();
  const response = p1.waitForResponse(
    (r) => r.url().endsWith('/reservations') && r.request().method() === 'POST',
  );
  const peerSocket = secondSocket;
  const invalidation = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      peerSocket.off('framereceived', onFrame);
      reject(Error('Segundo contexto não recebeu invalidação WebSocket'));
    }, 5_000);
    const onFrame = (frame: { payload: string | Buffer }) => {
      try {
        const event = JSON.parse(String(frame.payload)) as { type?: string; kind?: string };
        if (event.type !== 'agenda.invalidate' || event.kind !== 'reservation.changed') return;
        clearTimeout(timer);
        peerSocket.off('framereceived', onFrame);
        resolve();
      } catch {
        // Other frames do not satisfy the evidence assertion.
      }
    };
    peerSocket.on('framereceived', onFrame);
  });
  await form.getByRole('button', { name: 'Criar reserva' }).click();
  assert.equal((await response).status(), 200);
  await invalidation;
  await p2.getByText('Cliente Fictício').first().waitFor({ timeout: 10_000 });
  await p1.getByText('Reserva criada na agenda.').waitFor();
  const count = (
    await pool.query(
      `SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies o
     JOIN arena_identity.reservations r ON r.organization_id=o.organization_id AND r.id=o.reservation_id
     WHERE r.customer_id=$1 AND o.active`,
      [customer],
    )
  ).rows[0].n;
  assert.equal(count, 2);
  await form.getByLabel('Espaço').selectOption(a);
  await form.getByText('Horário indisponível').waitFor();
  assert.equal(await form.getByRole('button', { name: 'Criar reserva' }).isDisabled(), true);
  await p1.screenshot({ path: evidence + 'desktop-1440x900.png', fullPage: true });
  await p1.setViewportSize({ width: 768, height: 1024 });
  assert(
    await p1.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Transbordamento tablet',
  );
  await p1.screenshot({ path: evidence + 'tablet-768x1024.png', fullPage: true });
  await p1.setViewportSize({ width: 390, height: 844 });
  assert(
    await p1.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Transbordamento mobile',
  );
  await p1.screenshot({ path: evidence + 'mobile-390x844.png', fullPage: true });
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.locator('.agenda-card.pending').filter({ hasText: '18:00' }).click();
  const details = p1.getByRole('dialog', { name: 'Detalhes da reserva' });
  await details.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await p2.locator('.agenda-card.confirmed').filter({ hasText: '18:00' }).waitFor();
  await details.getByRole('button', { name: 'Remarcar' }).click();
  const rescheduleForm = details.locator('form.agenda-action-form');
  await rescheduleForm.getByLabel('Novo horário').fill('20:00');
  await rescheduleForm.getByRole('button', { name: 'Verificar novo horário' }).click();
  await rescheduleForm.getByText(/Disponível · Novo valor:/).waitFor();
  await p1.screenshot({ path: evidence + 'reschedule-preview-1440x900.png', fullPage: true });
  await rescheduleForm.getByRole('button', { name: 'Confirmar remarcação' }).click();
  await p2.locator('.agenda-card.confirmed').filter({ hasText: '20:00' }).waitFor();
  await details.getByRole('button', { name: 'Cancelar' }).click();
  const cancelForm = details.locator('form.agenda-action-form');
  await cancelForm.getByText(/Política V1: 0%/).waitFor();
  await cancelForm.getByLabel('Motivo').fill('Cancelamento no cenário visual');
  await p1.screenshot({ path: evidence + 'cancellation-preview-1440x900.png', fullPage: true });
  await cancelForm.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await p2.locator('.agenda-card.cancelled').filter({ hasText: '20:00' }).waitFor();
  await details.getByRole('button', { name: 'Fechar' }).click();
  const availableAfterCancel = await fetch(
    `http://localhost:3001/api/v1/orgs/${slug}/availability?venueId=${full}&date=${date}&startTime=20%3A00&durationMinutes=60`,
    { headers: { origin, cookie } },
  );
  assert.equal(availableAfterCancel.status, 200);
  assert.equal(((await availableAfterCancel.json()) as { available: boolean }).available, true);

  await second.setOffline(true);
  await form.getByLabel('Espaço').selectOption(b);
  await form.getByLabel('Início').fill('17:00');
  await form.getByText('Disponível').waitFor();
  await form.getByRole('button', { name: 'Criar reserva' }).click();
  await p1.locator('.agenda-card.pending').filter({ hasText: '17:00' }).waitFor();
  await second.setOffline(false);
  await p2
    .locator('.agenda-card.pending')
    .filter({ hasText: '17:00' })
    .waitFor({ timeout: 10_000 });

  await form.getByLabel('Início').fill('16:00');
  await form.getByLabel('Origem').selectOption('IN_PERSON');
  await form.getByLabel('Estado').selectOption('CONFIRMED');
  await form.getByText('Disponível').waitFor();
  await form.getByRole('button', { name: 'Criar reserva' }).click();
  await p2.locator('.agenda-card.confirmed').filter({ hasText: '16:00' }).waitFor();
  const otherForm = p2.getByRole('heading', { name: 'Nova reserva' }).locator('..').locator('form');
  await otherForm.getByLabel('Espaço').selectOption(b);
  await otherForm.getByLabel('Início').fill('16:00');
  await otherForm.getByText('Horário indisponível').waitFor();
  assert.equal(await otherForm.getByRole('button', { name: 'Criar reserva' }).isDisabled(), true);

  await form.getByLabel('Espaço').selectOption(a);
  await form.getByLabel('Início').fill('19:00');
  await form.getByLabel('Estado').selectOption('PENDING');
  await form.getByText('Disponível').waitFor();
  await form.getByRole('button', { name: 'Criar reserva' }).click();
  await p1.locator('.agenda-card.pending').filter({ hasText: '19:00' }).waitFor();
  await form.getByText('Horário indisponível').waitFor();
  await p1.getByText('Novo contrato mensal').click();
  const monthly = p1
    .locator('details.agenda-monthly')
    .filter({ hasText: 'Novo contrato mensal' })
    .locator('form');
  await monthly.getByLabel('Início').fill(date);
  await monthly.getByRole('checkbox').nth(weekday).check();
  const firstMonthPreview = monthly.getByText(/Estimativa do primeiro mês:/);
  await firstMonthPreview.waitFor();
  const displayedEstimate = await firstMonthPreview.textContent();
  const contractResponse = p1.waitForResponse(
    (r) => r.url().endsWith('/recurrence-contracts') && r.request().method() === 'POST',
  );
  await monthly.getByRole('button', { name: 'Criar mensalista' }).click();
  const contractHttp = await contractResponse;
  assert.equal(contractHttp.status(), 200);
  const contract = (await contractHttp.json()) as { id: string; firstMonthAmountCents: number };
  assert(contract.firstMonthAmountCents > 0);
  assert(
    displayedEstimate?.includes(
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
        contract.firstMonthAmountCents / 100,
      ),
    ),
  );
  await p1.getByText('1 conflito(s) para analisar.').waitFor();
  await p1.getByText(/Mensalista criado\. Primeiro mês:/).waitFor();
  const resolveAnswers = [date, '21:00', 'Horário alternativo do cliente'];
  const answerResolve = (dialog: import('playwright-core').Dialog) => {
    void dialog.accept(resolveAnswers.shift());
  };
  p1.on('dialog', answerResolve);
  await p1.getByRole('button', { name: 'Outro horário' }).click();
  await p1.getByText('0 conflito(s) para analisar.').waitFor();
  p1.off('dialog', answerResolve);
  const moved = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM arena_identity.recurrence_exceptions WHERE kind='MOVED'",
  );
  assert.equal(moved.rows[0]?.n, 1);
  const generated = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM arena_identity.reservations r JOIN arena_identity.recurrences v ON v.organization_id=r.organization_id AND v.id=r.recurrence_id WHERE v.contract_id=$1',
    [contract.id],
  );
  assert((generated.rows[0]?.n ?? 0) > 1);
  await p1.screenshot({ path: evidence + 'monthly-1440x900.png', fullPage: true });
  await p1.locator('.agenda-card.confirmed').filter({ hasText: '21:00' }).click();
  const movedDetails = p1.getByRole('dialog', { name: 'Detalhes da reserva' });
  await movedDetails.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const movedCancel = movedDetails.locator('form.agenda-action-form');
  await movedCancel.getByLabel('Motivo').fill('Encerramento autorizado do contrato');
  await movedCancel.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await movedDetails.getByRole('button', { name: 'Fechar' }).click();
  await p1.getByLabel('Buscar cliente ou espaço').fill('Cliente Fictício');
  await p1.getByRole('button', { name: 'Buscar', exact: true }).click();
  await p1.locator('.agenda-contract-list button').first().click();
  const contractForm = p1.locator('form.agenda-contract-edit');
  const effective = new Date(new Date(date + 'T12:00:00Z').getTime() + 7 * 86400_000)
    .toISOString()
    .slice(0, 10);
  await contractForm.getByLabel('Início da nova versão').fill(effective);
  await contractForm.getByLabel('Valor por ocorrência (R$)').fill('120,00');
  await contractForm.getByLabel('Mensalidade (R$)').fill('450,00');
  const versionResponse = p1.waitForResponse(
    (r) =>
      r.url().includes(`/recurrence-contracts/${contract.id}/versions`) &&
      r.request().method() === 'POST',
    { timeout: 5000 },
  );
  await contractForm.getByRole('button', { name: 'Criar nova versão' }).click();
  const versionHttp = await versionResponse;
  assert.equal(versionHttp.status(), 200, await versionHttp.text());
  try {
    await p1.getByText('Nova versão do contrato criada.').waitFor({ timeout: 2000 });
  } catch (error) {
    console.error('contract UI diagnostic', {
      notice: await p1.locator('.agenda-notice').allTextContents(),
      detail: await p1.locator('.agenda-contract-detail').allTextContents(),
    });
    throw error;
  }
  await p1.screenshot({ path: evidence + 'contract-versioned-1440x900.png', fullPage: true });
  p1.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await p1.getByRole('button', { name: 'Encerrar contrato' }).click();
  await p1.getByText('Contrato encerrado.').waitFor();
  const contractState = await pool.query<{ status: string }>(
    'SELECT status FROM arena_identity.recurrence_contracts WHERE id=$1',
    [contract.id],
  );
  assert.equal(contractState.rows[0]?.status, 'ENDED');
  await writeFile(
    evidence + 'scenario.json',
    JSON.stringify(
      {
        twoSessions: true,
        createdPending: true,
        confirmed: true,
        rescheduled: true,
        cancelledAndReleased: true,
        synchronizedAfterOffline: true,
        inPersonConfirmedAndConflictingAttemptBlocked: true,
        monthlyContractViaInterface: contract.id,
        firstMonthAmountCents: contract.firstMonthAmountCents,
        generatedOccurrences: generated.rows[0]?.n,
        movedConflicts: moved.rows[0]?.n,
        contractVersionedAndEndedViaInterface: true,
        automatedSeconds: Math.round((Date.now() - started) / 1000),
        limitation:
          'Dois contextos autenticados da mesma conta, com sessões distintas; não mede tempo de operação humana.',
      },
      null,
      2,
    ) + '\n',
  );
  const orgId = (
    await pool.query('SELECT id FROM arena_identity.organizations WHERE slug=$1', [slug])
  ).rows[0].id as string;
  const benchDb = await pool.connect();
  try {
    await benchDb.query('BEGIN');
    await benchDb.query(
      `INSERT INTO arena_identity.reservations(organization_id,venue_id,customer_id,
      start_at,end_at,status,source,price_cents,price_source,notes)
      SELECT $1,$2,$3,
      (($4::date + (n/45) + time '06:00' + (n%45)*interval '15 minutes') AT TIME ZONE 'America/Sao_Paulo'),
      (($4::date + (n/45) + time '06:15' + (n%45)*interval '15 minutes') AT TIME ZONE 'America/Sao_Paulo'),
      'PENDING','ADMIN',2000,'DEFAULT','benchmark-phase4'
      FROM generate_series(0,299) AS n`,
      [orgId, a, customer, date],
    );
    await benchDb.query(
      `INSERT INTO arena_identity.schedule_occupancies(organization_id,unit_id,start_at,end_at,reservation_id)
      SELECT organization_id,$2,start_at,end_at,id FROM arena_identity.reservations
      WHERE organization_id=$1 AND notes='benchmark-phase4'`,
      [orgId, unitA],
    );
    await benchDb.query('COMMIT');
  } catch (error) {
    await benchDb.query('ROLLBACK');
    throw error;
  } finally {
    benchDb.release();
  }
  const nextWeek = new Date(new Date(date + 'T12:00:00Z').getTime() + 6 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const sqlLatencies: number[] = [],
    httpLatencies: number[] = [],
    renderLatencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const before = performance.now();
    const rows = await pool.query(
      `SELECT r.id,r.venue_id,r.start_at,r.end_at,r.status,c.name
      FROM arena_identity.reservations r JOIN arena_identity.customers c
      ON c.organization_id=r.organization_id AND c.id=r.customer_id
      WHERE r.organization_id=$1 AND r.start_at<($3::date+1) AND r.end_at>$2::date
      ORDER BY r.start_at,r.id LIMIT 1000`,
      [orgId, date, nextWeek],
    );
    sqlLatencies.push(Math.round((performance.now() - before) * 100) / 100);
    assert((rows.rowCount ?? 0) >= 301);
    const httpStart = performance.now();
    const response = await fetch(
      `http://localhost:3001/api/v1/orgs/${slug}/agenda?from=${date}&to=${nextWeek}`,
      { headers: { origin, cookie } },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { reservations: unknown[] };
    httpLatencies.push(Math.round((performance.now() - httpStart) * 100) / 100);
    assert(body.reservations.length >= 301);
  }
  await p1.setViewportSize({ width: 1440, height: 900 });
  for (let i = 0; i < 3; i++) {
    await p1.getByRole('button', { name: 'Dia', exact: true }).click();
    await p1.locator('.agenda-card.pending').first().waitFor();
    const before = performance.now();
    await p1.getByRole('button', { name: 'Semana', exact: true }).click();
    try {
      await p1.locator('.agenda-card.pending').nth(299).waitFor({ timeout: 5000 });
    } catch (error) {
      console.error('week render diagnostic', {
        pendingCards: await p1.locator('.agenda-card.pending').count(),
        allCards: await p1.locator('.agenda-card').count(),
        dayPressed: await p1
          .getByRole('button', { name: 'Dia', exact: true })
          .getAttribute('aria-pressed'),
        weekPressed: await p1
          .getByRole('button', { name: 'Semana', exact: true })
          .getAttribute('aria-pressed'),
      });
      throw error;
    }
    renderLatencies.push(Math.round((performance.now() - before) * 100) / 100);
  }
  const version = (await pool.query('SHOW server_version')).rows[0].server_version as string;
  const benchmark = {
    volume: 300,
    venues: 3,
    postgres: version,
    sqlMs: sqlLatencies,
    httpMs: httpLatencies,
    browserWeekMs: renderLatencies,
    environment:
      'PostgreSQL 16 descartável em Docker local; Next production, Fastify e Chrome headless',
    cache: 'cinco consultas sequenciais em banco aquecido; renderização alternando dia/semana',
    limitation:
      'fixture sintético, três venues, sem latência de rede de produção; navegador automatizado não mede usabilidade humana',
  };
  await writeFile(
    evidence + 'benchmark.json',
    await prettier.format(JSON.stringify(benchmark), { parser: 'json' }),
  );
  assert(
    httpLatencies.every((ms) => ms < 300),
    'Agenda semanal excedeu 300 ms local',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    rateLimited,
    [],
    'Limite HTTP atingido pelo cenário visual: ' + JSON.stringify([...traffic]),
  );
  console.log(
    JSON.stringify({
      scenario: 'phase4-ui',
      automatedSeconds: Math.round((Date.now() - started) / 1000),
      physicalOccupancies: count,
      twoBrowserContexts: true,
      peerWebSocketInvalidation: true,
      benchmark,
      screenshots: [
        'desktop-1440x900.png',
        'tablet-768x1024.png',
        'mobile-390x844.png',
        'reschedule-preview-1440x900.png',
        'cancellation-preview-1440x900.png',
        'monthly-1440x900.png',
        'contract-versioned-1440x900.png',
      ],
    }),
  );
  await first.close();
  await second.close();
} catch (error) {
  process.exitCode = 1;
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await next.close();
  await app.close();
  await pool.end();
}

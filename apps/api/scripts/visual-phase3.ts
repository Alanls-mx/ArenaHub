import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { chromium, type Locator } from 'playwright-core';
import { requireDisposableDatabase } from '../src/__tests__/disposable-database.js';
import { buildApp } from '../src/app.js';
import { provision } from '../src/identity/provision.js';

const db = await requireDisposableDatabase(),
  pool = new Pool({ connectionString: db });
const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
const next = createRequire(webDir + 'package.json')('next')({ dev: false, dir: webDir });
const server = createServer(next.getRequestHandler());
const origin = 'http://localhost:34872';
const app = buildApp({
  databaseUrl: db,
  origin,
  logLevel: 'silent',
  proxy: { internalHost: '127.0.0.1:3001', ips: ['127.0.0.1'] },
});
const evidence = fileURLToPath(new URL('../../../docs/evidence/phase3/', import.meta.url));
let browser;
const start = Date.now();
const slug = 'arena-fase3',
  email = 'owner-fase3@example.org',
  password = randomUUID();
try {
  await mkdir(evidence, { recursive: true });
  await provision(pool, {
    slug,
    name: 'Arena Experimental',
    ownerName: 'Owner da arena',
    email,
    password,
  });
  await next.prepare();
  await app.listen({ port: 3001, host: '127.0.0.1' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(34872, 'localhost', resolve);
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(origin);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('heading', { name: 'Visão geral' }).waitFor();
  const nav = page.getByRole('navigation', { name: 'Administração da arena' });
  async function submit(button: Locator) {
    const response = page.waitForResponse(
      (r) => r.url().includes('/api/v1/orgs/') && r.request().method() !== 'GET',
    );
    await button.click();
    const result = await response;
    assert.equal(result.status(), 200);
    try {
      await page.getByText('Alteração salva com sucesso.').waitFor({ timeout: 5000 });
    } catch (error) {
      throw new Error(
        `Resposta ${result.request().method()} ${new URL(result.url()).pathname} aprovada, mas UI sem confirmação: ${await page.locator('.operations [role=status]').allTextContents()}; erros: ${failures.join(' | ')}`,
        { cause: error },
      );
    }
  }
  await nav.getByRole('button', { name: 'Modalidades' }).click();
  const sportForm = page
    .getByRole('heading', { name: 'Adicionar modalidade' })
    .locator('..')
    .locator('form');
  for (const name of ['Futebol Society', 'Beach Tennis']) {
    await sportForm.locator('input[name=name]').fill(name);
    await submit(sportForm.getByRole('button', { name: 'Salvar modalidade' }));
    await page.getByText(name, { exact: true }).first().waitFor();
  }
  await nav.getByRole('button', { name: 'Unidades físicas' }).click();
  const unitForm = page
    .getByRole('heading', { name: 'Nova unidade' })
    .locator('..')
    .locator('form');
  for (const name of ['Campo A físico', 'Campo B físico']) {
    await unitForm.locator('input[name=name]').fill(name);
    await submit(unitForm.getByRole('button', { name: 'Criar unidade' }));
  }
  await nav.getByRole('button', { name: 'Espaços' }).click();
  const venueForm = page
    .getByRole('heading', { name: 'Criar espaço' })
    .locator('..')
    .locator('form');
  async function venue(name: string, sport: string, physical: string[]) {
    await venueForm.locator('input[name=name]').fill(name);
    await venueForm.locator('input[name=price]').fill('80');
    await venueForm.getByLabel(sport, { exact: true }).check();
    for (const unit of physical) await venueForm.getByLabel(unit, { exact: true }).check();
    await submit(venueForm.getByRole('button', { name: 'Criar espaço' }));
    await page.getByText(name, { exact: true }).first().waitFor();
    await venueForm.getByLabel(sport, { exact: true }).uncheck();
    for (const unit of physical) await venueForm.getByLabel(unit, { exact: true }).uncheck();
  }
  await venue('Campo A', 'Futebol Society', ['Campo A físico']);
  await venue('Campo B', 'Futebol Society', ['Campo B físico']);
  await venue('Campo completo', 'Futebol Society', ['Campo A físico', 'Campo B físico']);
  await venue('Beach Tennis 1', 'Beach Tennis', []);
  await venue('Beach Tennis 2', 'Beach Tennis', []);
  await nav.getByRole('button', { name: 'Horários' }).click();
  await page.getByRole('heading', { name: 'Horários', exact: true }).waitFor();
  const venueSelect = page.locator('.operations select').first();
  for (const name of ['Campo completo', 'Campo A', 'Campo B', 'Beach Tennis 1', 'Beach Tennis 2']) {
    const option = venueSelect.locator('option', { hasText: name });
    const id = await option.getAttribute('value');
    if ((await venueSelect.inputValue()) !== id) {
      const response = page.waitForResponse(
        (r) =>
          r.url().includes('/venues/' + id + '/operating-hours') && r.request().method() === 'GET',
      );
      await venueSelect.selectOption(id!);
      await response;
    }
    await page.getByRole('button', { name: 'Adicionar turno' }).click();
    if (name === 'Campo completo') {
      await page.getByRole('button', { name: 'Adicionar turno' }).click();
      const shifts = page.locator('.shift-row');
      await shifts.nth(1).locator('select').selectOption('5');
      await shifts.nth(1).getByLabel('Abertura').fill('22:00');
      await shifts.nth(1).getByLabel('Fechamento').fill('02:00');
    }
    await submit(page.getByRole('button', { name: 'Salvar semana' }));
  }
  await nav.getByRole('button', { name: 'Exceções' }).click();
  const exceptionForm = page
    .getByRole('heading', { name: 'Adicionar exceção' })
    .locator('..')
    .locator('form');
  await exceptionForm.locator('input[name=date]').fill('2026-12-25');
  await exceptionForm.locator('input[name=description]').fill('Feriado de teste');
  await submit(exceptionForm.getByRole('button', { name: 'Salvar exceção' }));
  await nav.getByRole('button', { name: 'Preços' }).click();
  const ruleForm = page.getByRole('heading', { name: 'Nova regra' }).locator('..').locator('form');
  await ruleForm.locator('select[name=venueId]').selectOption({ label: 'Campo completo' });
  await ruleForm.locator('select[name=sportId]').selectOption({ label: 'Futebol Society' });
  await ruleForm.locator('select[name=weekday]').selectOption('2');
  await ruleForm.locator('input[name=startTime]').fill('18:00');
  await ruleForm.locator('input[name=endTime]').fill('20:00');
  await ruleForm.locator('input[name=price]').fill('100');
  await submit(ruleForm.getByRole('button', { name: 'Criar regra' }));
  const quoteForm = page.getByRole('heading', { name: 'Simulador' }).locator('..').locator('form');
  await quoteForm.locator('select[name=venueId]').selectOption({ label: 'Campo completo' });
  await quoteForm.locator('select[name=sportId]').selectOption({ label: 'Futebol Society' });
  await quoteForm.locator('input[name=date]').fill('2026-12-01');
  await quoteForm.locator('input[name=startTime]').fill('18:30');
  await quoteForm.getByRole('button', { name: 'Calcular preço' }).click();
  await page.locator('.quote-result').getByText('R$ 100,00', { exact: true }).waitFor();
  await quoteForm.locator('select[name=venueId]').selectOption({ label: 'Beach Tennis 1' });
  await quoteForm.locator('select[name=sportId]').selectOption({ label: 'Beach Tennis' });
  await quoteForm.getByRole('button', { name: 'Calcular preço' }).click();
  await page.locator('.quote-result').getByText('R$ 80,00', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Clientes' }).click();
  const customerForm = page
    .getByRole('heading', { name: 'Novo cliente' })
    .locator('..')
    .locator('form');
  await customerForm.locator('input[name=name]').fill('Cliente Fictício');
  await customerForm.locator('input[name=phone]').fill('+5511999999999');
  await submit(customerForm.getByRole('button', { name: 'Cadastrar cliente' }));
  await nav.getByRole('button', { name: 'Domínios' }).click();
  const domainForm = page
    .getByRole('heading', { name: 'Solicitar domínio próprio' })
    .locator('..')
    .locator('form');
  await domainForm.locator('input[name=hostname]').fill('agenda.arena-experimental.com.br');
  await submit(domainForm.getByRole('button', { name: 'Registrar solicitação' }));
  await page.getByText('agenda.arena-experimental.com.br').waitFor();
  const counts = await pool.query(`SELECT
    (SELECT count(*)::int FROM arena_identity.venues) venues,
    (SELECT count(*)::int FROM arena_identity.venue_units) units,
    (SELECT count(*)::int FROM arena_identity.venue_unit_links) links,
    (SELECT count(*)::int FROM arena_identity.sports) sports,
    (SELECT count(*)::int FROM arena_identity.operating_hours) hours,
    (SELECT count(*)::int FROM arena_identity.calendar_exceptions) exceptions,
    (SELECT count(*)::int FROM arena_identity.pricing_rules) prices,
    (SELECT count(*)::int FROM arena_identity.customers) customers,
    (SELECT count(*)::int FROM arena_identity.organization_domains WHERE status='pending') domains`);
  assert.deepEqual(counts.rows[0], {
    venues: 5,
    units: 4,
    links: 6,
    sports: 2,
    hours: 6,
    exceptions: 1,
    prices: 1,
    customers: 1,
    domains: 1,
  });
  await nav.getByRole('button', { name: 'Visão geral' }).click();
  await page.getByRole('heading', { name: 'Assistente de configuração' }).waitFor();
  await page.screenshot({ path: `${evidence}overview-1440x900.png`, fullPage: true });
  await nav.getByRole('button', { name: 'Espaços' }).click();
  await nav.getByRole('button', { name: 'Espaços' }).focus();
  await page.keyboard.press('Tab');
  assert(
    await page.evaluate(() => document.activeElement?.tagName === 'BUTTON'),
    'Navegação por teclado indisponível',
  );
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Transbordamento horizontal em ${width}`,
    );
    await page.screenshot({ path: `${evidence}${width}x${height}.png`, fullPage: true });
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  const seconds = Math.round((Date.now() - start) / 1000);
  assert(seconds < 1800, 'Configuração excedeu 30 minutos');
  console.log(
    JSON.stringify({
      scenario: 'phase3-ui',
      seconds,
      counts: counts.rows[0],
      screenshots: [1440, 768, 390],
    }),
  );
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

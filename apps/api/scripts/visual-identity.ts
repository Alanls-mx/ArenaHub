import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { chromium } from 'playwright-core';
import { GenericContainer } from 'testcontainers';
import { requireDisposableDatabase } from '../src/__tests__/disposable-database.js';
import { buildApp } from '../src/app.js';
import { seedLocalOrganizations } from '../src/identity/provision.js';
const db = await requireDisposableDatabase(),
  pool = new Pool({ connectionString: db });
const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
const next = createRequire(webDir + 'package.json')('next')({ dev: false, dir: webDir });
const server = createServer(next.getRequestHandler());
const origin = 'http://localhost:34871',
  app = buildApp({ databaseUrl: db, origin, logLevel: 'silent' });
const evidence = fileURLToPath(new URL('../../../docs/evidence/phase2/', import.meta.url));
let browser;
const mailbox = await new GenericContainer('axllent/mailpit:v1.22.3')
  .withExposedPorts(1025, 8025)
  .start();
process.env.SMTP_URL = 'smtp://' + mailbox.getHost() + ':' + mailbox.getMappedPort(1025);
const inbox = 'http://' + mailbox.getHost() + ':' + mailbox.getMappedPort(8025) + '/api/v1';
async function mailLink(address: string) {
  const res = await fetch(inbox + '/messages');
  const items = await res.json();
  const item = items.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((t) => t.Address === address),
  );
  assert(item, 'E-mail de teste esperado');
  const message = await (await fetch(inbox + '/message/' + item.ID)).json();
  const link = message.Text.trim();
  assert(link.startsWith(origin + '/#'));
  return link as string;
}

try {
  await mkdir(evidence, { recursive: true });
  await next.prepare();
  await app.listen({ port: 3001, host: '127.0.0.1' });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(34871, 'localhost', resolve);
  });
  const password = randomUUID(),
    email = 'equipe@example.org';
  await seedLocalOrganizations(pool, password);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    if (width === 1440) {
      await page.getByLabel('E-mail', { exact: true }).fill(email);
      await page.getByLabel('Senha', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).press('Enter');
    }
    await page.getByText('Você é Owner desta arena.').waitFor();
    await page.getByLabel('Arena ativa').selectOption('arena-sul');
    await page.locator('summary').filter({ hasText: 'Cargos e permissões' }).click();
    await page.locator('summary').filter({ hasText: 'Criar cargo' }).click();
    assert(await page.getByRole('checkbox', { name: 'Editar cargos', exact: true }).isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: evidence + width + 'x' + height + '.png', fullPage: true });
  }
  const inviteEmail = 'recepcao@example.org';
  await page.getByLabel('E-mail do convidado').fill(inviteEmail);
  await page.getByRole('button', { name: 'Enviar convite' }).click();
  await page.getByText(inviteEmail, { exact: false }).first().waitFor();
  const recipient = await browser.newPage();
  await recipient.goto(await mailLink(inviteEmail));
  await recipient.getByLabel('Seu nome').fill('Equipe local');
  await recipient.getByLabel('Senha', { exact: true }).fill(password);
  await recipient.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await recipient.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
  await recipient.getByRole('button', { name: 'Esqueci a senha' }).click();
  await recipient.getByLabel('E-mail', { exact: true }).fill(inviteEmail);
  await recipient.getByRole('button', { name: 'Enviar link' }).click();
  await recipient.getByText('Se a conta estiver ativa, você receberá o link por e-mail.').waitFor();
  const deadline = Date.now() + 10000;
  let reset = '';
  while (Date.now() < deadline) {
    const latest = await mailLink(inviteEmail);
    if (latest.includes('#reset=')) {
      reset = latest;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(reset, 'Recuperação enviada pelo SMTP');
  await recipient.goto('about:blank');
  await recipient.goto(reset);
  const changed = randomUUID();
  await recipient.getByLabel('Nova senha (mínimo 12 caracteres)').fill(changed);
  await recipient.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await recipient.getByLabel('E-mail', { exact: true }).fill(inviteEmail);
  await recipient.getByLabel('Senha', { exact: true }).fill(changed);
  await recipient.getByRole('button', { name: 'Entrar', exact: true }).click();
  await recipient.getByRole('heading', { name: 'Equipe da arena' }).waitFor();
} finally {
  await mailbox.stop();
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await next.close();
  await app.close();
  await pool.end();
}

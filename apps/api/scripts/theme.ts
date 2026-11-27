import { readFile } from 'node:fs/promises';
import { checkTheme } from '@arenahub/contracts';
const [op, file, slug] = process.argv.slice(2);
try {
  if (!file) throw Error('Informe o caminho do arquivo JSON');
  const theme = checkTheme(JSON.parse(await readFile(file, 'utf8')));
  if (op === 'publish') {
    if (!slug || !process.env.WEB_ORIGIN) throw Error('Informe slug e WEB_ORIGIN');
    const origin = new URL(process.env.WEB_ORIGIN).origin;
    if (
      !origin.startsWith('https://') &&
      !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
    )
      throw Error('HTTPS obrigatório');
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const auth = await fetch(origin + '/api/v1/auth/login', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: raw,
    });
    if (!auth.ok) throw Error('Login recusado');
    const cookie = auth.headers.getSetCookie()[0]?.split(';')[0];
    if (!cookie) throw Error('Sessão indisponível');
    try {
      const me = await fetch(origin + '/api/v1/auth/me', { headers: { cookie } });
      const { csrf } = await me.json();
      const headers = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
      try {
        const result = await fetch(origin + '/api/v1/orgs/' + encodeURIComponent(slug) + '/theme', {
          method: 'PUT',
          headers,
          body: JSON.stringify(theme),
        });
        if (!result.ok) throw Error('Publicação recusada');
      } finally {
        await fetch(origin + '/api/v1/auth/logout', { method: 'POST', headers });
      }
    } catch {
      throw Error('Falha na publicação do tema');
    }
  }
  console.log(op === 'publish' ? 'Tema publicado' : 'Tema aprovado');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha');
  process.exitCode = 1;
}

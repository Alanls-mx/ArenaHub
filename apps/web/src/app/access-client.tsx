'use client';
import {
  accessSchema,
  roleViewSchema,
  memberViewSchema,
  permissionCodes,
  sessionSchema,
  type Capability,
  type Theme,
} from '@arenahub/contracts';
import { useEffect, useState, type FormEvent } from 'react';

const permissionLabel: Record<Capability, string> = {
  'members.read': 'Consultar membros',
  'members.manage': 'Gerenciar membros e convites',
  'roles.manage': 'Editar cargos',
  'roles.assign': 'Atribuir cargos',
  'charges.read': 'Consultar cobrança individual',
  'payments.record': 'Registrar pagamentos',
  'pix.create': 'Gerar cobrança Pix',
  'finance.read': 'Consultar financeiro completo',
  'cashflow.read': 'Consultar fluxo de caixa',
  'revenue.read': 'Consultar receitas',
  'expenses.read': 'Consultar despesas',
  'reports.export': 'Exportar relatórios',
  'payments.reverse': 'Estornar lançamentos',
  'refunds.request': 'Solicitar reembolso',
  'integrations.manage': 'Gerenciar integrações financeiras',
};
type Me = ReturnType<typeof sessionSchema.parse>;
type Role = ReturnType<typeof roleViewSchema.parse>;
type Member = ReturnType<typeof memberViewSchema.parse>;
type Access = ReturnType<typeof accessSchema.parse>;
async function api(path: string, method = 'GET', body?: unknown, csrf?: string) {
  const res = await fetch('/api/v1' + path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok)
    throw Error(
      (
        {
          400: 'Dados ou link inválidos.',
          401: 'Credenciais inválidas ou sessão encerrada.',
          403: 'Operação sem autorização.',
          404: 'Recurso indisponível nesta arena.',
          409: 'A alteração conflita com o estado atual.',
          429: 'Limite de tentativas atingido. Tente mais tarde.',
        } as Record<number, string>
      )[res.status] ?? 'Serviço indisponível.',
    );
  return res.json();
}
function form(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
}
function Field({
  label,
  name,
  type = 'text',
  value,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | undefined;
}) {
  return (
    <label>
      {label}
      <input required name={name} type={type} defaultValue={value} />
    </label>
  );
}
export default function AccessClient() {
  const [me, setMe] = useState<Me | null>(null),
    [mode, setMode] = useState('loading'),
    [secret, setSecret] = useState(''),
    [org, setOrg] = useState(''),
    [message, msg] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    const user = sessionSchema.parse(await api('/auth/me'));
    setMe(user);
    setOrg(user.organizations[0]?.slug ?? '');
    setMode('account');
  }
  useEffect(() => {
    let active = true;
    const fragment = new URLSearchParams(location.hash.slice(1));
    const kind = ['invite', 'reset'].find((k) => fragment.has(k));
    async function initialize() {
      if (kind) {
        await Promise.resolve();
        if (!active) return;
        setSecret(fragment.get(kind) ?? '');
        setMode(kind);
        history.replaceState(null, '', location.pathname);
      } else {
        try {
          const user = sessionSchema.parse(await api('/auth/me'));
          if (active) {
            setMe(user);
            setOrg(user.organizations[0]?.slug ?? '');
            setMode('account');
          }
        } catch {
          if (active) setMode('login');
        }
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    const data = form(e);
    setBusy(true);
    msg('');
    try {
      if (mode === 'login') {
        await api('/auth/login', 'POST', data);
        await load();
      } else if (mode === 'forgot') {
        await api('/auth/password/forgot', 'POST', data);
        msg('Se a conta estiver ativa, você receberá o link por e-mail.');
      } else {
        await api(mode === 'invite' ? '/auth/invites/accept' : '/auth/password/reset', 'POST', {
          ...data,
          token: secret,
        });
        setSecret('');
        setMode('login');
        msg('Dados salvos. Entre com sua senha.');
      }
    } catch (e) {
      msg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shell identity">
      <header className="brand">
        Arena<span>Hub</span>
      </header>
      {mode === 'loading' ? (
        <p>Carregando conta…</p>
      ) : mode === 'account' && me ? (
        <div className="workspace">
          <aside>
            <h2>Minha conta</h2>
            <strong>{me.name}</strong>
            <p>{me.email}</p>
            <label>
              Arena ativa
              <select value={org} onChange={(e) => setOrg(e.target.value)}>
                {me.organizations.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <nav aria-label="Navegação da conta">
              <a href="#equipe">Equipe da arena</a>
            </nav>
            <Sessions csrf={me.csrf} />
            <details>
              <summary>Alterar senha</summary>
              <form
                onSubmit={async (e) => {
                  const data = form(e);
                  e.currentTarget.reset();
                  try {
                    await api('/auth/password/change', 'POST', data, me.csrf);
                    await load();
                    msg('Senha atualizada.');
                  } catch (e) {
                    msg((e as Error).message);
                  }
                }}
              >
                <Field label="Senha atual" name="currentPassword" type="password" />
                <Field label="Nova senha" name="password" type="password" />
                <button>Salvar nova senha</button>
              </form>
            </details>
            <button
              onClick={async () => {
                try {
                  await api('/auth/logout', 'POST', undefined, me.csrf);
                  setMe(null);
                  setMode('login');
                  msg('');
                } catch (e) {
                  msg((e as Error).message);
                }
              }}
            >
              Sair
            </button>
          </aside>
          {org ? (
            <Team key={org} org={org} csrf={me.csrf} />
          ) : (
            <p>Nenhuma arena ativa para esta conta.</p>
          )}
        </div>
      ) : (
        <section className="signin">
          <h1>
            {
              {
                login: 'Entrar',
                forgot: 'Recuperar acesso',
                invite: 'Aceitar convite',
                reset: 'Definir nova senha',
              }[mode]
            }
          </h1>
          <form key={mode} onSubmit={submit}>
            {['login', 'forgot'].includes(mode) && (
              <Field name="email" label="E-mail" type="email" />
            )}
            {mode === 'invite' && <Field name="name" label="Seu nome" />}
            {mode !== 'forgot' && (
              <Field
                name="password"
                label={mode === 'reset' ? 'Nova senha (mínimo 12 caracteres)' : 'Senha'}
                type="password"
              />
            )}
            <button disabled={busy}>
              {busy
                ? 'Aguarde…'
                : mode === 'login'
                  ? 'Entrar'
                  : mode === 'forgot'
                    ? 'Enviar link'
                    : 'Confirmar'}
            </button>
          </form>
          <button
            className="linkbtn"
            onClick={() => {
              setMode(mode === 'login' ? 'forgot' : 'login');
              msg('');
            }}
          >
            {mode === 'login' ? 'Esqueci a senha' : 'Voltar ao login'}
          </button>
        </section>
      )}
      <p role="status">{message}</p>
    </main>
  );
}
function Sessions({ csrf }: { csrf: string }) {
  const [items, set] = useState<{ id: string; seen_at: string; current: boolean }[]>([]),
    [error, msg] = useState('');
  async function refresh() {
    set(await api('/auth/sessions'));
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) void refresh().catch((e) => msg(e.message));
      }}
    >
      <summary>Sessões</summary>
      {items.map((s) => (
        <div key={s.id}>
          {s.current ? 'Atual' : new Date(s.seen_at).toLocaleString('pt-BR')}
          {!s.current && (
            <button
              onClick={async () => {
                if (confirm('Encerrar esta sessão?'))
                  try {
                    await api('/auth/sessions/' + s.id, 'DELETE', undefined, csrf);
                    await refresh();
                  } catch (e) {
                    msg((e as Error).message);
                  }
              }}
            >
              Encerrar
            </button>
          )}
        </div>
      ))}
      <span role="status">{error}</span>
    </details>
  );
}
function Team({ org, csrf }: { org: string; csrf: string }) {
  const base = '/orgs/' + encodeURIComponent(org),
    [settings, setSettings] = useState<{ name: string; timezone: string; theme: Theme | null }>(),
    [access, setAccess] = useState<Access>(),
    [roles, setRoles] = useState<Role[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [invites, setInvites] = useState<{ id: string; email: string }[]>([]),
    [message, msg] = useState(''),
    [revision, bump] = useState(0);
  useEffect(() => {
    let live = true;
    async function load() {
      const a = accessSchema.parse(await api(base + '/access'));
      const [ctx, m, r, i] = await Promise.all([
        api(base + '/context'),
        a.permissions.some((p) => ['members.read', 'members.manage', 'roles.assign'].includes(p))
          ? api(base + '/members')
          : [],
        a.permissions.some((p) => ['members.read', 'roles.assign', 'roles.manage'].includes(p))
          ? api(base + '/roles')
          : [],
        a.permissions.includes('members.manage') ? api(base + '/invites') : [],
      ]);
      if (live) {
        setSettings(ctx);
        setAccess(a);
        setRoles(roleViewSchema.array().parse(r));
        setMembers(memberViewSchema.array().parse(m));
        setInvites(i);
      }
    }
    void load().catch((e) => {
      if (live) {
        setAccess(undefined);
        msg(e.message);
      }
    });
    return () => {
      live = false;
    };
  }, [base, revision]);
  useEffect(() => {
    const colors = settings?.theme?.colors;
    if (!colors) return;
    const root = document.documentElement.style;
    const saved = new Map<string, string>();
    for (const [key, color] of Object.entries(colors)) {
      if (typeof color !== 'string') continue;
      const prop = '--color-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      saved.set(prop, root.getPropertyValue(prop));
      root.setProperty(prop, color);
    }
    return () => {
      for (const [key, value] of saved) root.setProperty(key, value);
    };
  }, [settings]);
  async function save(path: string, method: string, body?: unknown) {
    msg('');
    try {
      await api(base + path, method, body, csrf);
      msg('Alteração salva.');
      bump((n) => n + 1);
    } catch (e) {
      msg((e as Error).message);
    }
  }
  return (
    <section id="equipe">
      <h1>Equipe da arena</h1>
      <p role="status">{message}</p>
      {!access ? (
        <p>Consultando acesso…</p>
      ) : (
        <>
          {access.owner && (
            <>
              <p>Você é Owner desta arena.</p>
              <details>
                <summary>Configurações da arena</summary>
                <form key={revision} onSubmit={(e) => void save('', 'PATCH', form(e))}>
                  <Field name="name" label="Nome da organização" value={settings?.name} />
                  <Field name="timezone" label="Fuso horário IANA" value={settings?.timezone} />
                  <button>Atualizar organização</button>
                </form>
              </details>
            </>
          )}
          {access.permissions.includes('members.manage') && (
            <details open>
              <summary>Convites</summary>
              <form
                onSubmit={(e) => {
                  void save('/invites', 'POST', form(e));
                }}
              >
                <Field label="E-mail do convidado" name="email" type="email" />
                <button>Enviar convite</button>
              </form>
              {!invites.length && <p>Nenhum convite pendente.</p>}
              {invites.map((i) => (
                <p key={i.id}>
                  {i.email}{' '}
                  <button
                    onClick={() => {
                      if (confirm('Revogar convite?')) void save('/invites/' + i.id, 'DELETE');
                    }}
                  >
                    Revogar
                  </button>
                </p>
              ))}
            </details>
          )}
          {access.permissions.some((p) =>
            ['members.read', 'members.manage', 'roles.assign'].includes(p),
          ) && (
            <details open>
              <summary>Membros ({members.length})</summary>
              {members.map((m) => (
                <article key={m.id + revision}>
                  <h3>{m.name}</h3>
                  <p>
                    {m.email} · {m.is_owner ? 'Owner · ' : ''}
                    {{ active: 'Ativo', suspended: 'Suspenso', revoked: 'Revogado' }[m.status]}
                  </p>
                  {!m.is_owner && m.id !== access.userId && (
                    <>
                      {access.permissions.includes('roles.assign') && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void save('/members/' + m.id + '/roles', 'PUT', {
                              roles: new FormData(e.currentTarget).getAll('role'),
                            });
                          }}
                        >
                          {roles.map((r) => (
                            <label key={r.id}>
                              <input
                                type="checkbox"
                                name="role"
                                value={r.id}
                                defaultChecked={m.roles.includes(r.id)}
                                disabled={r.permissions.some(
                                  (p) => !access.permissions.includes(p),
                                )}
                              />
                              {r.name}
                            </label>
                          ))}
                          <button>Salvar cargos</button>
                        </form>
                      )}
                      {access.permissions.includes('members.manage') &&
                        (['active', 'suspended', 'revoked'] as const)
                          .filter((s) => s !== m.status)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                if (confirm('Alterar o acesso de ' + m.name + '?'))
                                  void save('/members/' + m.id + '/status', 'PUT', { status: s });
                              }}
                            >
                              {{ active: 'Ativar', suspended: 'Suspender', revoked: 'Revogar' }[s]}
                            </button>
                          ))}
                    </>
                  )}
                  {access.owner &&
                    m.status === 'active' &&
                    (!m.is_owner || members.filter((x) => x.is_owner).length > 1) && (
                      <form
                        onSubmit={(e) => {
                          const { password } = form(e);
                          e.currentTarget.reset();
                          if (confirm('Alterar a propriedade deste membro?'))
                            void save('/members/' + m.id + '/owner', 'PUT', {
                              owner: !m.is_owner,
                              password,
                            });
                        }}
                      >
                        <Field name="password" label="Confirme sua senha" type="password" />
                        <button>{m.is_owner ? 'Remover propriedade' : 'Adicionar Owner'}</button>
                      </form>
                    )}
                </article>
              ))}
            </details>
          )}
          {access.permissions.includes('roles.manage') && (
            <details>
              <summary>Cargos e permissões</summary>
              <p>
                As alterações afetam todos os membros vinculados ao cargo. A propriedade é
                administrada na lista de membros.
              </p>
              {[undefined, ...roles].map((r) => (
                <details key={(r?.id ?? 'new') + revision}>
                  <summary>{r ? r.name + ' · ' + r.members + ' membros' : 'Criar cargo'}</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = new FormData(e.currentTarget);
                      void save('/roles' + (r ? '/' + r.id : ''), r ? 'PUT' : 'POST', {
                        name: d.get('name'),
                        description: d.get('description'),
                        permissions: d.getAll('permission'),
                      });
                    }}
                  >
                    <Field name="name" label="Nome do cargo" value={r?.name} />
                    <label>
                      Descrição
                      <input name="description" defaultValue={r?.description} />
                    </label>
                    {['Equipe', 'Financeiro'].map((group, i) => (
                      <fieldset key={group}>
                        <legend>{group}</legend>
                        {permissionCodes
                          .filter((p) => /^(members|roles)\./.test(p) !== Boolean(i))
                          .map((p) => (
                            <label key={p}>
                              <input
                                type="checkbox"
                                name="permission"
                                value={p}
                                defaultChecked={r?.permissions.includes(p)}
                                disabled={!access.permissions.includes(p)}
                              />
                              {permissionLabel[p]}
                              {!access.permissions.includes(p) && ' · delegação indisponível'}
                            </label>
                          ))}
                      </fieldset>
                    ))}
                    <button>Salvar cargo</button>
                  </form>
                  {r && (
                    <button
                      onClick={() => {
                        if (confirm('Excluir cargo e retirar suas atribuições?'))
                          void save('/roles/' + r.id, 'DELETE');
                      }}
                    >
                      Excluir cargo
                    </button>
                  )}
                </details>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}

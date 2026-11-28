'use client';
import {
  accessSchema,
  customerPageSchema,
  domainViewSchema,
  exceptionViewSchema,
  hoursViewSchema,
  itemPageSchema,
  pricingRuleViewSchema,
  quoteViewSchema,
  venuePageSchema,
  type Capability,
} from '@arenahub/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Item = { id: string; name: string; archived_at?: string | null };
type Venue = Item & {
  sport_ids: string[];
  unit_ids: string[];
  default_price_per_hour_cents: number | null;
  color: string | null;
  sort_order: number;
  hours_count: number;
};
type Shift = {
  id?: string;
  weekday: number;
  open_time: string;
  close_time: string;
  spans_full_day: boolean;
};
type Exception = {
  id: string;
  venue_id: string | null;
  date: string;
  kind: string;
  open_time: string | null;
  close_time: string | null;
  description: string;
};
type Rule = {
  id: string;
  venue_id: string;
  sport_id: string | null;
  specific_date: string | null;
  weekday: number | null;
  start_minute: number;
  end_minute: number;
  price_per_hour_cents: number;
  valid_from: string | null;
  valid_until: string | null;
  archived_at: string | null;
};
type Customer = Item & { phone: string | null; email: string | null };
type Domain = { id: string; hostname: string; kind: string; status: string };
type Page<T> = { items: T[]; nextCursor: string | null };
type Panel =
  | 'inicio'
  | 'espacos'
  | 'unidades'
  | 'modalidades'
  | 'horarios'
  | 'calendario'
  | 'precos'
  | 'clientes'
  | 'dominios';
const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const minuteText = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const centsToInput = (cents: number) =>
  `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, '0')}`;
const centsFromInput = (raw: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw Error('Valor monetário inválido.');
  const [whole, fraction = ''] = raw.split('.');
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Valor monetário excessivo.');
  return Number(cents);
};
const money = (cents: number) => {
  const whole = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(
    Number(BigInt(cents) / 100n),
  );
  return `R$\u00a0${whole},${String(BigInt(cents) % 100n).padStart(2, '0')}`;
};
const data = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return new FormData(e.currentTarget);
};
const resetForm = (e: FormEvent<HTMLFormElement>) => {
  const form = e.currentTarget;
  return () => form.reset();
};
const text = (d: FormData, key: string) => String(d.get(key) ?? '').trim();

export default function Operations({ org, csrf }: { org: string; csrf: string }) {
  const base = '/api/v1/orgs/' + encodeURIComponent(org);
  const [panel, setPanel] = useState<Panel>('inicio');
  const [access, setAccess] = useState<Set<Capability>>(new Set());
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [sports, setSports] = useState<Item[]>([]),
    [venues, setVenues] = useState<Venue[]>([]),
    [venueResults, setVenueResults] = useState<Venue[]>([]),
    [units, setUnits] = useState<Item[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]),
    [rules, setRules] = useState<Rule[]>([]),
    [domains, setDomains] = useState<Domain[]>([]);
  const [venueId, setVenueId] = useState(''),
    [shifts, setShifts] = useState<Shift[]>([]),
    [query, setQuery] = useState(''),
    [cursor, setCursor] = useState<string | null>(null);
  const [venueSearch, setVenueSearch] = useState(''),
    [includeArchived, setIncludeArchived] = useState(false),
    [venueCursor, setVenueCursor] = useState<string | null>(null);
  const [includeArchivedCustomers, setIncludeArchivedCustomers] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null),
    [editingVenue, setEditingVenue] = useState<Venue | null>(null),
    [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [quote, setQuote] = useState<{
    available: boolean;
    totalCents?: number;
    segments?: {
      from: string;
      to: string;
      ruleId: string | null;
      pricePerHourCents: number;
      minutes: number;
    }[];
    reason?: string;
  } | null>(null);
  const call = useCallback(
    async (path: string, method = 'GET', body?: unknown) => {
      const res = await fetch(base + path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw Error(
          problem.code === 'PRICING_RULE_OVERLAP'
            ? 'Essa faixa conflita com outra regra de mesmo escopo.'
            : `Operação recusada (${res.status}).`,
        );
      }
      return res.json();
    },
    [base, csrf],
  );
  const refresh = useCallback(
    async (known?: Set<Capability>) => {
      const caps = known ?? new Set(accessSchema.parse(await call('/access')).permissions);
      if (!known) setAccess(caps);
      const read = async <T,>(path: string, cap: Capability, empty: T): Promise<T> =>
        caps.has(cap) ? call(path) : empty;
      const [s, v, u, c, e, p, d] = await Promise.all([
        read<Page<Item>>('/sports?limit=100', 'sports.read', { items: [], nextCursor: null }),
        read<Page<Venue>>('/venues?limit=100', 'venues.read', { items: [], nextCursor: null }),
        read<Page<Item>>('/units?limit=100', 'venues.read', { items: [], nextCursor: null }),
        read<Page<Customer>>('/customers?limit=100', 'customers.read', {
          items: [],
          nextCursor: null,
        }),
        read<Exception[]>('/calendar-exceptions', 'hours.read', []),
        read<Rule[]>('/pricing-rules', 'pricing.read', []),
        read<Domain[]>('/domains', 'domains.manage', []),
      ]);
      const sportsPage = itemPageSchema.parse(s),
        venuesPage = venuePageSchema.parse(v),
        unitsPage = itemPageSchema.parse(u),
        customersPage = customerPageSchema.parse(c);
      setSports(sportsPage.items);
      setVenues(venuesPage.items);
      setVenueResults(venuesPage.items);
      setVenueCursor(venuesPage.nextCursor);
      setUnits(unitsPage.items);
      setCustomers(customersPage.items);
      setExceptions(exceptionViewSchema.array().parse(e));
      setRules(pricingRuleViewSchema.array().parse(p));
      setDomains(domainViewSchema.array().parse(d));
      setVenueId((previous) => previous || venuesPage.items[0]?.id || '');
    },
    [call],
  );
  useEffect(() => {
    let alive = true;
    async function initialize() {
      await Promise.resolve();
      await refresh();
    }
    void initialize()
      .catch((e) => {
        if (alive) setMessage((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!venueId || !access.has('hours.read')) return;
    void call('/venues/' + venueId + '/operating-hours')
      .then((x: Shift[]) => setShifts(hoursViewSchema.array().parse(x)))
      .catch((e) => setMessage(e.message));
  }, [venueId, access, call]);
  async function save(path: string, method: string, body: unknown, after?: () => void) {
    setBusy(true);
    setMessage('');
    try {
      await call(path, method, body);
      await refresh(access);
      after?.();
      setMessage('Alteração salva com sucesso.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const can = (cap: Capability) => access.has(cap);
  const nav: { key: Panel; label: string; cap?: Capability }[] = [
    { key: 'inicio', label: 'Visão geral' },
    { key: 'espacos', label: 'Espaços', cap: 'venues.read' },
    { key: 'unidades', label: 'Unidades físicas', cap: 'venues.read' },
    { key: 'modalidades', label: 'Modalidades', cap: 'sports.read' },
    { key: 'horarios', label: 'Horários', cap: 'hours.read' },
    { key: 'calendario', label: 'Exceções', cap: 'hours.read' },
    { key: 'precos', label: 'Preços' },
    { key: 'clientes', label: 'Clientes', cap: 'customers.read' },
    { key: 'dominios', label: 'Domínios', cap: 'domains.manage' },
  ];
  const selectVenue = (label: string) => (
    <label>
      {label}
      <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
        <option value="">Selecione</option>
        {venues.map((v) => (
          <option value={v.id} key={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </label>
  );
  const selectSports = (selected: string[] = []) =>
    sports.map((s) => (
      <label className="check-line" key={s.id}>
        <input
          type="checkbox"
          name="sportId"
          value={s.id}
          defaultChecked={selected.includes(s.id)}
        />
        {s.name}
      </label>
    ));
  const selectUnits = (selected: string[] = []) =>
    units.map((u) => (
      <label className="check-line" key={u.id}>
        <input
          type="checkbox"
          name="unitId"
          value={u.id}
          defaultChecked={selected.includes(u.id)}
        />
        {u.name}
      </label>
    ));
  const step = (label: string, done: boolean, target: Panel) => (
    <button className="setup-step" onClick={() => setPanel(target)}>
      <span>{done ? '✓' : '○'}</span>
      <strong>{label}</strong>
      <small>{done ? 'Configurado' : 'Pendente'}</small>
    </button>
  );
  return (
    <section className="operations">
      <div className="operations-head">
        <div>
          <span className="eyebrow">Estrutura operacional</span>
          <h1>{nav.find((n) => n.key === panel)?.label}</h1>
          <p>Configure sua arena com dados persistidos e regras verificadas pelo servidor.</p>
        </div>
        <span className="arena-pill">{org}</span>
      </div>
      <nav className="operations-nav" aria-label="Administração da arena">
        {nav
          .filter(
            (n) =>
              (n.key === 'precos' && (can('pricing.read') || can('pricing.simulate'))) ||
              (n.key !== 'precos' && (!n.cap || can(n.cap))),
          )
          .map((n) => (
            <button
              key={n.key}
              aria-current={panel === n.key ? 'page' : undefined}
              onClick={() => {
                setPanel(n.key);
                setMessage('');
              }}
            >
              {n.label}
            </button>
          ))}
      </nav>
      {loading ? (
        <div className="op-card">Carregando configuração…</div>
      ) : (
        <>
          {message && (
            <p role="status" className="op-notice">
              {message}
            </p>
          )}
          {panel === 'inicio' && (
            <>
              <div className="metric-grid">
                <div className="metric">
                  <strong>{venues.length}</strong>
                  <span>Espaços ativos</span>
                </div>
                <div className="metric">
                  <strong>{units.length}</strong>
                  <span>Unidades físicas</span>
                </div>
                <div className="metric">
                  <strong>{sports.length}</strong>
                  <span>Modalidades</span>
                </div>
                <div className="metric">
                  <strong>{customers.length}</strong>
                  <span>Clientes</span>
                </div>
              </div>
              <div className="op-card">
                <h2>Assistente de configuração</h2>
                <p>Retome qualquer etapa. Cada item configurado fica salvo no PostgreSQL.</p>
                <div className="setup-grid">
                  {step('1. Espaços', venues.length > 0, 'espacos')}
                  {step(
                    '2. Composição',
                    venues.some((v) => v.unit_ids.length > 1),
                    'unidades',
                  )}
                  {step(
                    '3. Horários',
                    venues.length > 0 && venues.every((v) => v.hours_count > 0),
                    'horarios',
                  )}
                  {step(
                    '4. Preços',
                    venues.some((v) => v.default_price_per_hour_cents !== null) || rules.length > 0,
                    'precos',
                  )}
                  {step(
                    '5. Revisar',
                    venues.length > 0 &&
                      venues.every(
                        (v) =>
                          v.unit_ids.length > 0 &&
                          v.hours_count > 0 &&
                          (v.default_price_per_hour_cents !== null ||
                            rules.some((r) => r.venue_id === v.id && !r.archived_at)),
                      ),
                    'inicio',
                  )}
                </div>
                <div className="review-list">
                  <h3>Revisão atual</h3>
                  <p>
                    {venues.length} espaços · {units.length} unidades · {sports.length} modalidades
                    · {exceptions.length} exceções · {rules.filter((r) => !r.archived_at).length}{' '}
                    regras de preço.
                  </p>
                </div>
              </div>
            </>
          )}
          {panel === 'modalidades' && (
            <div className="op-grid">
              <div className="op-card">
                <h2>Modalidades</h2>
                {sports.length ? (
                  sports.map((s) => (
                    <article className="op-row" key={s.id}>
                      <div>
                        <strong>{s.name}</strong>
                        <small>Modalidade ativa</small>
                      </div>
                      {can('sports.manage') && (
                        <div className="op-actions">
                          <button
                            onClick={() => {
                              const name = prompt('Novo nome', s.name);
                              if (name) void save('/sports/' + s.id, 'PATCH', { name });
                            }}
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Arquivar modalidade?'))
                                void save('/sports/' + s.id, 'DELETE', null);
                            }}
                          >
                            Arquivar
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <p>Nenhuma modalidade cadastrada.</p>
                )}
              </div>
              {can('sports.manage') && (
                <div className="op-card">
                  <h2>Adicionar modalidade</h2>
                  <form
                    onSubmit={(e) => {
                      const d = data(e);
                      void save('/sports', 'POST', { name: text(d, 'name') }, resetForm(e));
                    }}
                  >
                    <label>
                      Nome
                      <input name="name" required maxLength={80} placeholder="Ex.: Beach Tennis" />
                    </label>
                    <button disabled={busy}>Salvar modalidade</button>
                  </form>
                </div>
              )}
            </div>
          )}
          {panel === 'clientes' && (
            <div className="op-grid">
              <div className="op-card">
                <h2>Clientes</h2>
                <label>
                  Buscar cliente
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setCursor(null);
                    }}
                    placeholder="Nome"
                  />
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={includeArchivedCustomers}
                    onChange={(e) => setIncludeArchivedCustomers(e.target.checked)}
                  />{' '}
                  Incluir arquivados
                </label>
                <button
                  onClick={async () => {
                    try {
                      const x: Page<Customer> = await call(
                        '/customers?' +
                          new URLSearchParams({
                            q: query,
                            archived: String(includeArchivedCustomers),
                            limit: '25',
                          }),
                      );
                      setCustomers(x.items);
                      setCursor(x.nextCursor);
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                >
                  Buscar
                </button>
                {customers.length ? (
                  customers.map((c) => (
                    <article className="op-row" key={c.id}>
                      <div>
                        <strong>
                          {c.name}
                          {c.archived_at ? ' · Arquivado' : ''}
                        </strong>
                        <small>{c.phone || c.email || 'Sem contato'}</small>
                      </div>
                      {!c.archived_at && (can('customers.manage') || can('customers.archive')) && (
                        <div className="op-actions">
                          {can('customers.manage') && (
                            <button onClick={() => setEditingCustomer(c)}>Editar</button>
                          )}
                          {can('customers.archive') && (
                            <button
                              onClick={() => {
                                if (confirm('Arquivar cliente?'))
                                  void save('/customers/' + c.id, 'DELETE', null);
                              }}
                            >
                              Arquivar
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <p>Nenhum cliente encontrado.</p>
                )}
                {cursor && (
                  <button
                    onClick={async () => {
                      const x: Page<Customer> = await call(
                        '/customers?' +
                          new URLSearchParams({
                            q: query,
                            archived: String(includeArchivedCustomers),
                            limit: '25',
                            cursor,
                          }),
                      );
                      setCustomers([...customers, ...x.items]);
                      setCursor(x.nextCursor);
                    }}
                  >
                    Carregar mais
                  </button>
                )}
              </div>
              {can('customers.manage') && (
                <div className="op-card">
                  <h2>{editingCustomer ? 'Editar cliente' : 'Novo cliente'}</h2>
                  <form
                    key={editingCustomer?.id ?? 'new'}
                    onSubmit={async (e) => {
                      const d = data(e);
                      const reset = resetForm(e);
                      const phone = text(d, 'phone');
                      if (phone && !editingCustomer) {
                        try {
                          const duplicates: Page<Customer> = await call(
                            '/customers?phone=' + encodeURIComponent(phone),
                          );
                          if (
                            duplicates.items.length &&
                            !confirm(
                              `O telefone já pertence a ${duplicates.items.map((c) => c.name).join(', ')}. Cadastrar outra pessoa?`,
                            )
                          )
                            return;
                        } catch (error) {
                          setMessage((error as Error).message);
                          return;
                        }
                      }
                      void save(
                        '/customers' + (editingCustomer ? '/' + editingCustomer.id : ''),
                        editingCustomer ? 'PATCH' : 'POST',
                        {
                          name: text(d, 'name'),
                          phone: phone || null,
                          email: text(d, 'email') || null,
                        },
                        () => {
                          reset();
                          setEditingCustomer(null);
                        },
                      );
                    }}
                  >
                    <label>
                      Nome
                      <input
                        name="name"
                        required
                        maxLength={120}
                        defaultValue={editingCustomer?.name}
                      />
                    </label>
                    <label>
                      Telefone E.164
                      <input
                        name="phone"
                        placeholder="+5511999999999"
                        defaultValue={editingCustomer?.phone ?? ''}
                      />
                    </label>
                    <label>
                      E-mail
                      <input
                        name="email"
                        type="email"
                        defaultValue={editingCustomer?.email ?? ''}
                      />
                    </label>
                    <button disabled={busy}>
                      {editingCustomer ? 'Salvar cliente' : 'Cadastrar cliente'}
                    </button>
                    {editingCustomer && (
                      <button type="button" onClick={() => setEditingCustomer(null)}>
                        Cancelar edição
                      </button>
                    )}
                  </form>
                </div>
              )}
            </div>
          )}
          {panel === 'unidades' && (
            <div className="op-grid">
              <div className="op-card">
                <h2>Recursos físicos</h2>
                <p>
                  Uma unidade pode compor mais de um espaço. Espaços que compartilham unidade não
                  poderão ser ocupados ao mesmo tempo na Fase 4.
                </p>
                {units.map((u) => (
                  <article className="op-row" key={u.id}>
                    <div>
                      <strong>{u.name}</strong>
                      <small>
                        {venues
                          .filter((v) => v.unit_ids.includes(u.id))
                          .map((v) => v.name)
                          .join(' · ') || 'Sem espaço vinculado'}
                      </small>
                    </div>
                    {can('units.manage') && (
                      <div className="op-actions">
                        <button
                          onClick={() => {
                            const name = prompt('Nome da unidade', u.name);
                            if (name) void save('/units/' + u.id, 'PATCH', { name });
                          }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Arquivar unidade sem vínculos ativos?'))
                              void save('/units/' + u.id, 'DELETE', null);
                          }}
                        >
                          Arquivar
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              {can('units.manage') && (
                <div className="op-card">
                  <h2>Nova unidade</h2>
                  <form
                    onSubmit={(e) => {
                      const d = data(e);
                      void save('/units', 'POST', { name: text(d, 'name') }, resetForm(e));
                    }}
                  >
                    <label>
                      Nome
                      <input name="name" required placeholder="Campo A" />
                    </label>
                    <button disabled={busy}>Criar unidade</button>
                  </form>
                  <h2>Editar composição</h2>
                  {selectVenue('Espaço reservável')}
                  {venueId && (
                    <form
                      key={venueId + units.length}
                      onSubmit={(e) => {
                        const d = data(e);
                        void save('/venues/' + venueId + '/units', 'PUT', {
                          unitIds: d.getAll('unitId'),
                        });
                      }}
                    >
                      <fieldset>
                        <legend>
                          Unidades usadas por {venues.find((v) => v.id === venueId)?.name}
                        </legend>
                        {selectUnits(venues.find((v) => v.id === venueId)?.unit_ids)}
                      </fieldset>
                      <button disabled={busy}>Salvar composição</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}
          {panel === 'espacos' && (
            <div className="op-grid">
              <div className="op-card">
                <h2>Espaços reserváveis</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const page: Page<Venue> = await call(
                        '/venues?' +
                          new URLSearchParams({
                            q: venueSearch,
                            archived: String(includeArchived),
                            limit: '25',
                          }),
                      );
                      setVenueResults(page.items);
                      setVenueCursor(page.nextCursor);
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  <label>
                    Buscar espaço
                    <input
                      value={venueSearch}
                      onChange={(e) => setVenueSearch(e.target.value)}
                      placeholder="Nome do espaço"
                    />
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={includeArchived}
                      onChange={(e) => setIncludeArchived(e.target.checked)}
                    />{' '}
                    Incluir arquivados
                  </label>
                  <button>Aplicar filtros</button>
                </form>
                {venueResults.length ? (
                  venueResults.map((v) => (
                    <article
                      className="op-row"
                      key={v.id}
                      style={
                        v.color
                          ? { borderLeft: '4px solid ' + v.color, paddingLeft: 10 }
                          : undefined
                      }
                    >
                      <div>
                        <strong>{v.name}</strong>
                        <small>
                          {v.archived_at ? 'Arquivado · ' : ''}
                          {v.unit_ids.length} unidade{v.unit_ids.length === 1 ? '' : 's'} ·{' '}
                          {v.sport_ids
                            .map((id) => sports.find((s) => s.id === id)?.name)
                            .filter(Boolean)
                            .join(', ') || 'Sem modalidade'}{' '}
                          ·{' '}
                          {v.default_price_per_hour_cents === null
                            ? 'Preço a definir'
                            : money(v.default_price_per_hour_cents) + '/h'}
                        </small>
                      </div>
                      {can('venues.manage') && !v.archived_at && (
                        <div className="op-actions">
                          <button onClick={() => setEditingVenue(v)}>Editar</button>
                          <button
                            onClick={() => {
                              if (confirm('Arquivar este espaço?'))
                                void save('/venues/' + v.id, 'DELETE', null);
                            }}
                          >
                            Arquivar
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <p>
                    Comece criando um espaço. Para um espaço simples, a unidade física é criada
                    automaticamente.
                  </p>
                )}
                {venueCursor && (
                  <button
                    onClick={async () => {
                      const page: Page<Venue> = await call(
                        '/venues?' +
                          new URLSearchParams({
                            q: venueSearch,
                            archived: String(includeArchived),
                            limit: '25',
                            cursor: venueCursor,
                          }),
                      );
                      setVenueResults([...venueResults, ...page.items]);
                      setVenueCursor(page.nextCursor);
                    }}
                  >
                    Carregar mais espaços
                  </button>
                )}
              </div>
              {can('venues.manage') && (
                <div className="op-card">
                  <h2>{editingVenue ? 'Editar espaço' : 'Criar espaço'}</h2>
                  <form
                    key={editingVenue?.id ?? 'new'}
                    onSubmit={(e) => {
                      const d = data(e);
                      const price = text(d, 'price');
                      const reset = resetForm(e);
                      let priceCents: number | null = null;
                      try {
                        priceCents = price ? centsFromInput(price) : null;
                      } catch (error) {
                        setMessage((error as Error).message);
                        return;
                      }
                      void save(
                        '/venues' + (editingVenue ? '/' + editingVenue.id : ''),
                        editingVenue ? 'PATCH' : 'POST',
                        {
                          name: text(d, 'name'),
                          sportIds: d.getAll('sportId'),
                          ...(!editingVenue && d.getAll('unitId').length
                            ? { unitIds: d.getAll('unitId') }
                            : {}),
                          defaultPricePerHourCents: priceCents,
                          color: text(d, 'color') || null,
                          sortOrder: Number(text(d, 'sortOrder') || 0),
                        },
                        () => {
                          reset();
                          setEditingVenue(null);
                        },
                      );
                    }}
                  >
                    <label>
                      Nome do espaço
                      <input
                        name="name"
                        required
                        placeholder="Campo completo"
                        defaultValue={editingVenue?.name}
                      />
                    </label>
                    <label>
                      Preço padrão por hora (R$)
                      <input
                        name="price"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Opcional"
                        defaultValue={
                          editingVenue?.default_price_per_hour_cents == null
                            ? ''
                            : centsToInput(editingVenue.default_price_per_hour_cents)
                        }
                      />
                    </label>
                    <div className="form-pair">
                      <label>
                        Cor do espaço
                        <input
                          name="color"
                          placeholder="#10B981"
                          pattern="#[0-9A-Fa-f]{6}"
                          defaultValue={editingVenue?.color ?? ''}
                        />
                      </label>
                      <label>
                        Ordem de exibição
                        <input
                          name="sortOrder"
                          type="number"
                          step="1"
                          defaultValue={editingVenue?.sort_order ?? 0}
                        />
                      </label>
                    </div>
                    <fieldset>
                      <legend>Modalidades</legend>
                      {selectSports(editingVenue?.sport_ids)}
                    </fieldset>
                    {!editingVenue && (
                      <fieldset>
                        <legend>Unidades existentes (opcional)</legend>
                        <p>
                          Sem seleção, criaremos uma unidade exclusiva. Para espaço integral,
                          selecione as partes físicas.
                        </p>
                        {selectUnits()}
                      </fieldset>
                    )}
                    {editingVenue && <p>A composição física é editada em Unidades físicas.</p>}
                    <button disabled={busy}>
                      {editingVenue ? 'Salvar espaço' : 'Criar espaço'}
                    </button>
                    {editingVenue && (
                      <button type="button" onClick={() => setEditingVenue(null)}>
                        Cancelar edição
                      </button>
                    )}
                  </form>
                </div>
              )}
            </div>
          )}
          {panel === 'horarios' && (
            <div className="op-card">
              <h2>Horários semanais</h2>
              {selectVenue('Espaço')}
              {venueId && (
                <>
                  <p>
                    Fechamento anterior à abertura significa dia seguinte. Horários iguais exigem a
                    opção 24 horas.
                  </p>
                  {shifts.map((s, i) => (
                    <div className="shift-row" key={s.id ?? i}>
                      <select
                        aria-label="Dia"
                        value={s.weekday}
                        onChange={(e) =>
                          setShifts(
                            shifts.map((v, j) =>
                              j === i ? { ...v, weekday: Number(e.target.value) } : v,
                            ),
                          )
                        }
                      >
                        {weekdays.map((w, n) => (
                          <option value={n} key={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Abertura"
                        type="time"
                        value={s.open_time}
                        onChange={(e) =>
                          setShifts(
                            shifts.map((v, j) =>
                              j === i ? { ...v, open_time: e.target.value } : v,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label="Fechamento"
                        type="time"
                        value={s.close_time}
                        onChange={(e) =>
                          setShifts(
                            shifts.map((v, j) =>
                              j === i ? { ...v, close_time: e.target.value } : v,
                            ),
                          )
                        }
                      />
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={s.spans_full_day}
                          onChange={(e) =>
                            setShifts(
                              shifts.map((v, j) =>
                                j === i ? { ...v, spans_full_day: e.target.checked } : v,
                              ),
                            )
                          }
                        />
                        24h
                      </label>
                      <button onClick={() => setShifts(shifts.filter((_, j) => j !== i))}>
                        Remover
                      </button>
                    </div>
                  ))}
                  {can('hours.manage') && (
                    <div className="op-actions">
                      <button
                        onClick={() =>
                          setShifts([
                            ...shifts,
                            {
                              weekday: 1,
                              open_time: '08:00',
                              close_time: '22:00',
                              spans_full_day: false,
                            },
                          ])
                        }
                      >
                        Adicionar turno
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void save('/venues/' + venueId + '/operating-hours', 'PUT', {
                            shifts: shifts.map((s) => ({
                              weekday: s.weekday,
                              openTime: s.open_time,
                              closeTime: s.close_time,
                              spansFullDay: s.spans_full_day,
                            })),
                          })
                        }
                      >
                        Salvar semana
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {panel === 'calendario' && (
            <div className="op-grid">
              <div className="op-card">
                <h2>Exceções de calendário</h2>
                {exceptions.length ? (
                  exceptions.map((x) => (
                    <article className="op-row" key={x.id}>
                      <div>
                        <strong>
                          {x.date} · {x.kind === 'CLOSED' ? 'Fechado' : 'Horário especial'}
                        </strong>
                        <small>
                          {x.venue_id
                            ? venues.find((v) => v.id === x.venue_id)?.name
                            : 'Arena toda'}{' '}
                          {x.open_time && `· ${x.open_time}–${x.close_time}`} {x.description}
                        </small>
                      </div>
                      {can('hours.manage') && (
                        <button
                          onClick={() => {
                            if (confirm('Remover exceção?'))
                              void save('/calendar-exceptions/' + x.id, 'DELETE', null);
                          }}
                        >
                          Remover
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <p>Nenhuma exceção cadastrada.</p>
                )}
              </div>
              {can('hours.manage') && (
                <div className="op-card">
                  <h2>Adicionar exceção</h2>
                  <form
                    onSubmit={(e) => {
                      const d = data(e),
                        kind = text(d, 'kind');
                      void save(
                        '/calendar-exceptions',
                        'POST',
                        {
                          venueId: text(d, 'venueId') || null,
                          date: text(d, 'date'),
                          kind,
                          openTime: kind === 'SPECIAL_HOURS' ? text(d, 'openTime') : null,
                          closeTime: kind === 'SPECIAL_HOURS' ? text(d, 'closeTime') : null,
                          description: text(d, 'description'),
                        },
                        resetForm(e),
                      );
                    }}
                  >
                    <label>
                      Escopo
                      <select name="venueId">
                        <option value="">Arena inteira</option>
                        {venues.map((v) => (
                          <option value={v.id} key={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Data
                      <input type="date" name="date" required />
                    </label>
                    <label>
                      Tipo
                      <select name="kind">
                        <option value="CLOSED">Fechado</option>
                        <option value="SPECIAL_HOURS">Horário especial</option>
                      </select>
                    </label>
                    <div className="form-pair">
                      <label>
                        Abertura especial
                        <input type="time" name="openTime" />
                      </label>
                      <label>
                        Fechamento especial
                        <input type="time" name="closeTime" />
                      </label>
                    </div>
                    <label>
                      Descrição
                      <input name="description" placeholder="Feriado ou evento" />
                    </label>
                    <button disabled={busy}>Salvar exceção</button>
                  </form>
                </div>
              )}
            </div>
          )}
          {panel === 'precos' && (
            <div className="op-grid">
              {can('pricing.read') && (
                <div className="op-card">
                  <h2>Regras de preço</h2>
                  <p>
                    Prioridade: data específica → modalidade e dia → dia → preço padrão do espaço.
                  </p>
                  {rules
                    .filter((r) => !r.archived_at)
                    .map((r) => (
                      <article className="op-row" key={r.id}>
                        <div>
                          <strong>
                            {money(r.price_per_hour_cents)}/h ·{' '}
                            {venues.find((v) => v.id === r.venue_id)?.name}
                          </strong>
                          <small>
                            {r.specific_date || weekdays[r.weekday ?? 0]} ·{' '}
                            {minuteText(r.start_minute)}–{minuteText(r.end_minute)}{' '}
                            {r.sport_id && '· ' + sports.find((s) => s.id === r.sport_id)?.name}
                          </small>
                        </div>
                        {can('pricing.manage') && (
                          <div className="op-actions">
                            <button onClick={() => setEditingRule(r)}>Editar</button>
                            <button
                              onClick={() => {
                                if (confirm('Arquivar regra?'))
                                  void save('/pricing-rules/' + r.id, 'DELETE', null);
                              }}
                            >
                              Arquivar
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  {!rules.some((r) => !r.archived_at) && (
                    <p>Sem regras. O preço padrão do espaço ainda pode ser simulado.</p>
                  )}
                  {rules.some((r) => r.archived_at) && (
                    <details>
                      <summary>
                        Histórico de regras arquivadas ({rules.filter((r) => r.archived_at).length})
                      </summary>
                      {rules
                        .filter((r) => r.archived_at)
                        .map((r) => (
                          <p key={r.id}>
                            {venues.find((v) => v.id === r.venue_id)?.name ?? 'Espaço arquivado'} ·{' '}
                            {money(r.price_per_hour_cents)}/h ·{' '}
                            {r.specific_date ?? weekdays[r.weekday ?? 0]}
                          </p>
                        ))}
                    </details>
                  )}
                </div>
              )}
              <div>
                {can('pricing.manage') && (
                  <div className="op-card">
                    <h2>{editingRule ? 'Editar regra' : 'Nova regra'}</h2>
                    <form
                      key={editingRule?.id ?? 'new'}
                      onSubmit={(e) => {
                        const d = data(e),
                          day = text(d, 'weekday'),
                          date = text(d, 'specificDate');
                        const reset = resetForm(e);
                        let priceCents: number;
                        try {
                          priceCents = centsFromInput(text(d, 'price'));
                        } catch (error) {
                          setMessage((error as Error).message);
                          return;
                        }
                        void save(
                          '/pricing-rules' + (editingRule ? '/' + editingRule.id : ''),
                          editingRule ? 'PATCH' : 'POST',
                          {
                            venueId: editingRule?.venue_id ?? text(d, 'venueId'),
                            sportId: text(d, 'sportId') || null,
                            specificDate: date || null,
                            weekday: date ? null : Number(day),
                            startTime: text(d, 'startTime'),
                            endTime: text(d, 'endTime'),
                            pricePerHourCents: priceCents,
                            validFrom: date ? null : text(d, 'validFrom') || null,
                            validUntil: date ? null : text(d, 'validUntil') || null,
                          },
                          () => {
                            reset();
                            setEditingRule(null);
                          },
                        );
                      }}
                    >
                      <label>
                        Espaço
                        <select
                          name="venueId"
                          required
                          defaultValue={editingRule?.venue_id}
                          disabled={Boolean(editingRule)}
                        >
                          {venues.map((v) => (
                            <option value={v.id} key={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Modalidade (opcional)
                        <select name="sportId" defaultValue={editingRule?.sport_id ?? ''}>
                          <option value="">Todas</option>
                          {sports.map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Data específica (opcional)
                        <input
                          type="date"
                          name="specificDate"
                          defaultValue={editingRule?.specific_date ?? ''}
                        />
                      </label>
                      <label>
                        Dia semanal
                        <select name="weekday" defaultValue={editingRule?.weekday ?? 0}>
                          {weekdays.map((w, i) => (
                            <option value={i} key={w}>
                              {w}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="form-pair">
                        <label>
                          Início
                          <input
                            type="time"
                            name="startTime"
                            required
                            defaultValue={
                              editingRule ? minuteText(editingRule.start_minute) : '08:00'
                            }
                          />
                        </label>
                        <label>
                          Fim
                          <input
                            type="time"
                            name="endTime"
                            required
                            defaultValue={
                              editingRule ? minuteText(editingRule.end_minute) : '22:00'
                            }
                          />
                        </label>
                      </div>
                      <div className="form-pair">
                        <label>
                          Válido desde
                          <input
                            type="date"
                            name="validFrom"
                            defaultValue={editingRule?.valid_from ?? ''}
                          />
                        </label>
                        <label>
                          Válido até
                          <input
                            type="date"
                            name="validUntil"
                            defaultValue={editingRule?.valid_until ?? ''}
                          />
                        </label>
                      </div>
                      <label>
                        Preço por hora (R$)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          name="price"
                          required
                          defaultValue={
                            editingRule ? centsToInput(editingRule.price_per_hour_cents) : undefined
                          }
                        />
                      </label>
                      <button disabled={busy}>
                        {editingRule ? 'Salvar regra' : 'Criar regra'}
                      </button>
                      {editingRule && (
                        <button type="button" onClick={() => setEditingRule(null)}>
                          Cancelar edição
                        </button>
                      )}
                    </form>
                  </div>
                )}
                {can('pricing.simulate') && (
                  <div className="op-card">
                    <h2>Simulador</h2>
                    <form
                      onSubmit={async (e) => {
                        const d = data(e);
                        try {
                          setQuote(
                            quoteViewSchema.parse(
                              await call(
                                '/pricing/quote?' +
                                  new URLSearchParams({
                                    venueId: text(d, 'venueId'),
                                    ...(text(d, 'sportId') ? { sportId: text(d, 'sportId') } : {}),
                                    date: text(d, 'date'),
                                    startTime: text(d, 'startTime'),
                                    durationMinutes: text(d, 'durationMinutes'),
                                  }),
                              ),
                            ),
                          );
                        } catch (error) {
                          setMessage((error as Error).message);
                        }
                      }}
                    >
                      <label>
                        Espaço
                        <select name="venueId" required>
                          {venues.map((v) => (
                            <option value={v.id} key={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Modalidade
                        <select name="sportId">
                          <option value="">Sem modalidade</option>
                          {sports.map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="form-pair">
                        <label>
                          Data
                          <input type="date" name="date" required />
                        </label>
                        <label>
                          Início
                          <input type="time" name="startTime" required defaultValue="19:00" />
                        </label>
                      </div>
                      <label>
                        Duração (minutos)
                        <input
                          type="number"
                          name="durationMinutes"
                          min="1"
                          max="1440"
                          defaultValue="60"
                          required
                        />
                      </label>
                      <button>Calcular preço</button>
                    </form>
                    {quote && (
                      <div className="quote-result" role="status">
                        {quote.available ? (
                          <>
                            <strong>{money(quote.totalCents ?? 0)}</strong>
                            {quote.segments?.map((s, i) => (
                              <p key={i}>
                                {s.from.slice(11)}–{s.to.slice(11)} · {s.minutes} min ·{' '}
                                {money(s.pricePerHourCents)}/h · {s.ruleId ? 'Regra' : 'Padrão'}
                              </p>
                            ))}
                          </>
                        ) : (
                          <p>Não existe preço para todo o período selecionado.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {panel === 'dominios' && (
            <div className="op-grid">
              <div className="op-card">
                <h2>Domínios registrados</h2>
                {domains.length ? (
                  domains.map((d) => (
                    <article className="op-row" key={d.id}>
                      <div>
                        <strong>{d.hostname}</strong>
                        <small>
                          {d.kind === 'platform'
                            ? 'Subdomínio da plataforma'
                            : 'Domínio personalizado'}{' '}
                          · {d.status}
                        </small>
                      </div>
                    </article>
                  ))
                ) : (
                  <p>
                    Nenhum domínio registrado. O nome do domínio da plataforma ainda será definido.
                  </p>
                )}
              </div>
              <div className="op-card">
                <h2>Solicitar domínio próprio</h2>
                <p>
                  O cadastro permanece pendente até verificação de DNS, TLS e autenticação. Ainda
                  não disponibiliza acesso público.
                </p>
                <form
                  onSubmit={(e) => {
                    const d = data(e);
                    void save(
                      '/domains/requests',
                      'POST',
                      { hostname: text(d, 'hostname') },
                      resetForm(e),
                    );
                  }}
                >
                  <label>
                    Hostname
                    <input name="hostname" required placeholder="agenda.suaarena.com.br" />
                  </label>
                  <button disabled={busy}>Registrar solicitação</button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

type Venue = { id: string; name: string; color: string | null; sport_ids: string[] };
type Person = { id: string; name: string };
type Reservation = {
  id: string;
  venue_id: string;
  customer_id: string;
  customer_name: string;
  sport_id: string | null;
  local_date: string;
  local_end_date: string;
  start_at: string;
  end_at: string;
  status: string;
  source: string;
  price_cents: number;
  version: number;
  notes: string;
  recurrence_id: string | null;
};
type Block = {
  id: string;
  venue_id: string;
  start_at: string;
  end_at: string;
  local_date: string;
  local_end_date: string;
  reason: string;
};
type Conflict = {
  id: string;
  occurrence_date: string;
  reason: string;
  venue_id: string;
  customer_id: string;
};
type RecurrenceRule = { weekday: number; startTime: string; durationMinutes: number };
type Contract = {
  id: string;
  recurrence_id: string;
  customer_name: string;
  venue_name: string;
  venue_id: string;
  sport_id: string | null;
  billing_mode: 'MONTHLY' | 'PER_OCCURRENCE';
  status: string;
  starts_on: string;
  ends_on: string | null;
  price_cents: string;
  monthly_amount_cents: string | null;
  rules: RecurrenceRule[];
  future_count: number;
  conflict_count: number;
};
type ContractEdit = {
  venueId: string;
  sportId: string | null;
  effectiveFrom: string;
  endsOn: string;
  price: string;
  monthly: string;
  rules: RecurrenceRule[];
};
type CancellationPreview = {
  originalPriceCents: number;
  policyPercent: number;
  feeCents: number;
  leadSeconds: number;
  policyVersion: number;
  note: string;
};
type ReschedulePreview = {
  available: boolean;
  oldPriceCents: number;
  newPriceCents: number;
  differenceCents: number;
  oldStartAt: string;
  newStartAt: string;
  expectedVersion: number;
};
type HistoryItem = {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
};
const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const centsText = (value: string) => (Number(value) / 100).toFixed(2).replace('.', ',');
const cents = (text: string) => {
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(text))
    throw Error('Informe o valor em reais com até duas casas.');
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const value = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Valor excessivo.');
  return Number(value);
};
const today = (zone?: string) =>
  new Date().toLocaleDateString('en-CA', zone ? { timeZone: zone } : undefined);
const addDays = (day: string, count: number) => {
  const value = new Date(day + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};
const hour = (value: string, zone: string) =>
  new Date(value).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  });
const labelDate = (value: string) =>
  new Date(value + 'T12:00:00Z').toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
const randomKey = () => crypto.randomUUID();

export default function Agenda({ org, csrf }: { org: string; csrf: string }) {
  const base = '/api/v1/orgs/' + encodeURIComponent(org);
  const [day, setDay] = useState(today);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const desiredView = useRef({ day, view });
  const refreshSequence = useRef(0);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [customers, setCustomers] = useState<Person[]>([]);
  const [sports, setSports] = useState<Person[]>([]);
  const [items, setItems] = useState<Reservation[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractSearch, setContractSearch] = useState('');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [contractHistory, setContractHistory] = useState<
    { id: number; action: string; created_at: string }[]
  >([]);
  const [contractEdit, setContractEdit] = useState<ContractEdit | null>(null);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>(
    'connecting',
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [actionMode, setActionMode] = useState<'cancel' | 'reschedule' | null>(null);
  const [cancellationPreview, setCancellationPreview] = useState<CancellationPreview | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [waiveFee, setWaiveFee] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleVenue, setRescheduleVenue] = useState('');
  const [rescheduleDuration, setRescheduleDuration] = useState(60);
  const [reschedulePreview, setReschedulePreview] = useState<ReschedulePreview | null>(null);
  const [venueId, setVenueId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [sportId, setSportId] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [duration, setDuration] = useState(60);
  const [initialStatus, setInitialStatus] = useState<'PENDING' | 'CONFIRMED'>('PENDING');
  const [source, setSource] = useState<'ADMIN' | 'IN_PERSON'>('ADMIN');
  const [price, setPrice] = useState<number | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [monthlyAmount, setMonthlyAmount] = useState('400,00');
  const [recurrencePrice, setRecurrencePrice] = useState('100,00');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceStart, setRecurrenceStart] = useState(today);
  const [firstMonthPreview, setFirstMonthPreview] = useState<number | null>(null);
  const [firstMonthPreviewError, setFirstMonthPreviewError] = useState('');
  const [firstMonthPreviewKey, setFirstMonthPreviewKey] = useState('');
  const firstMonthInputKey = `${recurrenceStart}|${monthlyAmount}|${recurrenceDays.join(',')}`;
  const can = (code: string) => permissions?.includes(code) ?? false;

  const call = useCallback(
    async (path: string, method = 'GET', body?: unknown, key?: string) => {
      const response = await fetch(base + path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as { code?: string };
        const labels: Record<string, string> = {
          SLOT_UNAVAILABLE: 'Horário ocupado. Atualize a disponibilidade.',
          OUTSIDE_OPERATING_HOURS: 'Fora do horário de funcionamento.',
          PRICE_UNAVAILABLE: 'Preço não configurado para este horário.',
          STALE_VERSION: 'A reserva mudou. Atualize a agenda.',
          FORBIDDEN: 'Seu cargo não permite esta operação.',
        };
        throw Error(labels[problem.code ?? ''] ?? `Operação indisponível (${response.status}).`);
      }
      return response.json();
    },
    [base, csrf],
  );
  useEffect(() => {
    if (!permissions?.includes('recurrences.manage') || !recurrenceDays.length) return;
    let active = true;
    const timer = setTimeout(() => {
      try {
        const query = new URLSearchParams({
          startsOn: recurrenceStart,
          monthlyAmountCents: String(cents(monthlyAmount)),
          weekdays: recurrenceDays.join(','),
        });
        void call(`/recurrence-contracts/first-month-preview?${query}`)
          .then((result: { firstMonthAmountCents: number }) => {
            if (!active) return;
            setFirstMonthPreview(result.firstMonthAmountCents);
            setFirstMonthPreviewError('');
            setFirstMonthPreviewKey(firstMonthInputKey);
          })
          .catch((error: Error) => {
            if (active) {
              setFirstMonthPreviewError(error.message);
              setFirstMonthPreviewKey(firstMonthInputKey);
            }
          });
      } catch (error) {
        if (active) {
          setFirstMonthPreviewError((error as Error).message);
          setFirstMonthPreviewKey(firstMonthInputKey);
        }
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [call, permissions, firstMonthInputKey, recurrenceDays, recurrenceStart, monthlyAmount]);

  const refresh = useCallback(async () => {
    if (desiredView.current.day !== day || desiredView.current.view !== view) return;
    const sequence = ++refreshSequence.current;
    const current = () =>
      sequence === refreshSequence.current &&
      desiredView.current.day === day &&
      desiredView.current.view === view;
    try {
      const until = view === 'week' ? addDays(day, 6) : day;
      const result = (await call(`/agenda?from=${day}&to=${until}`)) as {
        reservations: Reservation[];
        blocks: Block[];
      };
      if (!current()) return;
      setItems(result.reservations);
      setBlocks(result.blocks);
      setAvailabilityRevision((revision) => revision + 1);
      setError('');
      setSelected((old) =>
        old ? (result.reservations.find((r) => r.id === old.id) ?? null) : null,
      );
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setLoading(false);
    }
  }, [call, day, view]);
  useEffect(() => {
    desiredView.current = { day, view };
  }, [day, view]);
  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    void Promise.all([call('/access'), call('/context')])
      .then(async ([access, context]) => {
        const codes = access.permissions as string[];
        const [v, c, s, x, contracts] = await Promise.all([
          codes.includes('venues.read') ? call('/venues?limit=100') : { items: [] },
          codes.includes('customers.read') ? call('/customers?limit=100') : { items: [] },
          codes.includes('sports.read') ? call('/sports?limit=100') : { items: [] },
          codes.includes('recurrences.read') ? call('/recurrence-conflicts') : [],
          codes.includes('recurrences.read') ? call('/recurrence-contracts') : [],
        ]);
        if (!active) return;
        setPermissions(codes);
        setTimezone(context.timezone);
        setDay(today(context.timezone));
        setRecurrenceStart(today(context.timezone));
        setVenues(v.items);
        setCustomers(c.items);
        setSports(s.items);
        setConflicts(x);
        setContracts(contracts);
        setVenueId((old) => old || v.items[0]?.id || '');
        setCustomerId((old) => old || c.items[0]?.id || '');
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [call]);
  useEffect(() => {
    if (!permissions?.includes('reservations.read')) return;
    let active = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      invalidationTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (invalidationTimer) return;
      invalidationTimer = setTimeout(() => {
        invalidationTimer = undefined;
        if (active) void refresh();
      }, 1000);
    };
    const connect = () => {
      if (!active) return;
      setConnection('connecting');
      const url = new URL(window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (url.hostname === 'localhost' && url.protocol === 'ws:') url.port = '3001';
      url.pathname = `/api/v1/orgs/${encodeURIComponent(org)}/agenda/stream`;
      url.search = '';
      socket = new WebSocket(url.toString());
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string };
          if (payload.type === 'agenda.connected') {
            setConnection('connected');
            void refresh();
          }
          if (payload.type === 'agenda.invalidate') invalidate();
        } catch {
          /* An invalid event never mutates local state. */
        }
      };
      socket.onclose = () => {
        if (!active) return;
        setConnection('offline');
        retry = setTimeout(connect, 3000);
      };
      socket.onerror = () => {
        setConnection('offline');
      };
    };
    connect();
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      if (invalidationTimer) clearTimeout(invalidationTimer);
      socket?.close();
      window.removeEventListener('focus', focus);
    };
  }, [org, refresh, permissions]);
  useEffect(() => {
    if (!venueId || !day || !startTime) {
      return;
    }
    const query = new URLSearchParams({
      venueId,
      date: day,
      startTime,
      durationMinutes: String(duration),
      ...(sportId ? { sportId } : {}),
    });
    let active = true;
    void call('/availability?' + query)
      .then((result) => {
        if (active) {
          setAvailable(result.available);
          setPrice(result.priceCents);
        }
      })
      .catch(() => {
        if (active) {
          setAvailable(false);
          setPrice(null);
        }
      });
    return () => {
      active = false;
    };
  }, [call, venueId, sportId, day, startTime, duration, availabilityRevision]);
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void call(`/reservations/${selectedId}/history`)
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [call, selectedId]);
  const mutate = async (
    task: () => Promise<unknown>,
    success: string,
    refreshRecurrences = false,
  ) => {
    try {
      setBusy(true);
      setError('');
      const result = await task();
      setNotice(success || String(result ?? ''));
      await refresh();
      if (selected) setHistory(await call(`/reservations/${selected.id}/history`));
      if (refreshRecurrences && permissions?.includes('recurrences.read')) {
        const [updated, open] = await Promise.all([
          call('/recurrence-contracts?search=' + encodeURIComponent(contractSearch)),
          call('/recurrence-conflicts'),
        ]);
        setContracts(updated);
        setConflicts(open);
        setSelectedContract((old) =>
          old ? (updated.find((x: Contract) => x.id === old.id) ?? null) : null,
        );
        if (selectedContract)
          setContractHistory(await call(`/recurrence-contracts/${selectedContract.id}/history`));
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const openCancellation = async () => {
    if (!selected) return;
    try {
      setError('');
      setCancellationPreview(await call(`/reservations/${selected.id}/cancellation-preview`));
      setCancelReason('');
      setWaiveFee(false);
      setActionMode('cancel');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const checkReschedule = async () => {
    if (!selected) return;
    try {
      setError('');
      const query = new URLSearchParams({
        venueId: rescheduleVenue,
        date: rescheduleDate,
        startTime: rescheduleTime,
        durationMinutes: String(rescheduleDuration),
        expectedVersion: String(selected.version),
        ...(selected.sport_id ? { sportId: selected.sport_id } : {}),
      });
      setReschedulePreview(await call(`/reservations/${selected.id}/reschedule-preview?${query}`));
    } catch (e) {
      setReschedulePreview(null);
      setError((e as Error).message);
    }
  };
  const removeBlock = (id: string) => {
    void mutate(() => call(`/blocks/${id}/cancel`, 'POST', {}, randomKey()), 'Bloqueio removido.');
  };
  const selectContract = async (contract: Contract) => {
    setSelectedContract(contract);
    setContractEdit({
      venueId: contract.venue_id,
      sportId: contract.sport_id,
      effectiveFrom: addDays(
        contract.starts_on > today(timezone) ? contract.starts_on : today(timezone),
        1,
      ),
      endsOn: contract.ends_on ?? '',
      price: centsText(contract.price_cents),
      monthly: contract.monthly_amount_cents ? centsText(contract.monthly_amount_cents) : '',
      rules: contract.rules.map((rule) => ({ ...rule })),
    });
    try {
      setContractHistory(await call(`/recurrence-contracts/${contract.id}/history`));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate(
      () =>
        call(
          '/reservations',
          'POST',
          {
            customerId,
            venueId,
            sportId: sportId || null,
            date: day,
            startTime,
            durationMinutes: duration,
            initialStatus,
            source,
            notes: '',
          },
          randomKey(),
        ),
      'Reserva criada na agenda.',
    );
  };
  const createRecurrence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate(
      async () => {
        const result = await call(
          '/recurrence-contracts',
          'POST',
          {
            customerId,
            venueId,
            sportId: sportId || null,
            billingMode: 'MONTHLY',
            startsOn: recurrenceStart,
            endsOn: null,
            priceCents: cents(recurrencePrice),
            monthlyAmountCents: cents(monthlyAmount),
            rules: recurrenceDays.map((weekday) => ({
              weekday,
              startTime,
              durationMinutes: duration,
            })),
          },
          randomKey(),
        );
        return `Mensalista criado. Primeiro mês: ${money(result.firstMonthAmountCents)}.`;
      },
      '',
      true,
    );
  };
  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(day, i)) : [day];
  const statusLabel: Record<string, string> = {
    PENDING: 'Pendente',
    CONFIRMED: 'Confirmada',
    COMPLETED: 'Concluída',
    CANCELLED: 'Cancelada',
    NO_SHOW: 'Não compareceu',
  };
  return (
    <main className="agenda-page">
      <header className="agenda-hero">
        <div>
          <span className="agenda-kicker">OPERAÇÃO EM TEMPO REAL</span>
          <h1>Agenda da arena</h1>
          <p>Reservas, ocupação física e atendimento em um só lugar.</p>
        </div>
        <div className={'agenda-connection ' + connection} role="status">
          <span aria-hidden="true">●</span>{' '}
          {connection === 'connected'
            ? 'Ao vivo'
            : connection === 'connecting'
              ? 'Conectando'
              : 'Sem conexão ao vivo'}
        </div>
      </header>
      <div className="agenda-toolbar">
        <div className="agenda-segment">
          <button aria-pressed={view === 'day'} onClick={() => setView('day')}>
            Dia
          </button>
          <button aria-pressed={view === 'week'} onClick={() => setView('week')}>
            Semana
          </button>
        </div>
        <button
          className="agenda-quiet"
          onClick={() => setDay(addDays(day, view === 'week' ? -7 : -1))}
        >
          ←
        </button>
        <input
          aria-label="Data inicial"
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <button
          className="agenda-quiet"
          onClick={() => setDay(addDays(day, view === 'week' ? 7 : 1))}
        >
          →
        </button>
        <button className="agenda-quiet" onClick={() => setDay(today(timezone))}>
          Hoje
        </button>
        <button className="agenda-quiet" onClick={() => void refresh()}>
          Atualizar
        </button>
      </div>
      <div className="agenda-layout">
        <section className="agenda-board" aria-busy={loading}>
          {permissions && !can('reservations.read') && (
            <p className="agenda-empty">Seu cargo não permite consultar a agenda.</p>
          )}
          <div className="agenda-board-head">
            <h2>
              {view === 'day'
                ? labelDate(day)
                : `${labelDate(day)} — ${labelDate(addDays(day, 6))}`}
            </h2>
            <span>
              {items.filter((r) => !['CANCELLED', 'NO_SHOW'].includes(r.status)).length} reservas
            </span>
          </div>
          {loading && <p className="agenda-empty">Carregando agenda…</p>}
          {!loading &&
            days.map((date) => (
              <div className="agenda-day" key={date}>
                {view === 'week' && <h3>{labelDate(date)}</h3>}
                {venues.map((venue) => {
                  const entries = items.filter(
                    (r) =>
                      r.venue_id === venue.id && r.local_date <= date && r.local_end_date >= date,
                  );
                  const venueBlocks = blocks.filter(
                    (b) =>
                      b.venue_id === venue.id && b.local_date <= date && b.local_end_date >= date,
                  );
                  return (
                    <div className="agenda-venue" key={venue.id}>
                      <strong>
                        <span
                          className="agenda-color"
                          style={{ background: venue.color ?? 'var(--op-accent)' }}
                        />
                        {venue.name}
                      </strong>
                      <div className="agenda-entries">
                        {entries.map((r) => (
                          <button
                            key={r.id}
                            className={'agenda-card ' + r.status.toLowerCase()}
                            onClick={() => {
                              setSelected(r);
                              setActionMode(null);
                              setHistory([]);
                              setClockNow(Date.now());
                            }}
                          >
                            <span>
                              {hour(r.start_at, timezone)}–{hour(r.end_at, timezone)}{' '}
                              <b>{r.customer_name}</b>
                            </span>
                            <small>
                              {statusLabel[r.status] ?? r.status} · {money(r.price_cents)}
                            </small>
                          </button>
                        ))}
                        {venueBlocks.map((b) => (
                          <div className="agenda-card blocked" key={b.id}>
                            {hour(b.start_at, timezone)}–{hour(b.end_at, timezone)} · Bloqueado{' '}
                            <small>{b.reason}</small>
                            {can('schedule_blocks.manage') && (
                              <button
                                className="agenda-unblock"
                                onClick={() => {
                                  // The callback runs only after the click; no ref is read during render.
                                  // eslint-disable-next-line react-hooks/refs
                                  removeBlock(b.id);
                                }}
                              >
                                Desbloquear
                              </button>
                            )}
                          </div>
                        ))}
                        {!entries.length && !venueBlocks.length && (
                          <span className="agenda-vacant">Sem reservas</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          {!loading && !venues.length && (
            <p className="agenda-empty">Cadastre espaços, horários e clientes para começar.</p>
          )}
        </section>
        <div className="agenda-sidebar">
          {(can('reservations.create') || can('schedule_blocks.manage')) && (
            <section className="agenda-panel">
              <h2>Nova reserva</h2>
              <p>O horário é confirmado pelo servidor no momento de salvar.</p>
              {can('reservations.create') && (
                <form onSubmit={create} className="agenda-form">
                  <label>
                    Cliente
                    <select
                      required
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {customers.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Espaço
                    <select
                      required
                      value={venueId}
                      onChange={(e) => {
                        setVenueId(e.target.value);
                        setSportId('');
                      }}
                    >
                      {venues.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Modalidade
                    <select value={sportId} onChange={(e) => setSportId(e.target.value)}>
                      <option value="">Sem modalidade</option>
                      {sports
                        .filter((s) =>
                          venues.find((v) => v.id === venueId)?.sport_ids.includes(s.id),
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="agenda-form-row">
                    <label>
                      Início
                      <input
                        type="time"
                        step="900"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </label>
                    <label>
                      Duração
                      <select
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                      >
                        {[30, 60, 90, 120, 180].map((n) => (
                          <option key={n} value={n}>
                            {n} min
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="agenda-form-row">
                    <label>
                      Origem
                      <select
                        value={source}
                        onChange={(e) => setSource(e.target.value as 'ADMIN' | 'IN_PERSON')}
                      >
                        <option value="ADMIN">Administrativa</option>
                        <option value="IN_PERSON">Presencial</option>
                      </select>
                    </label>
                    <label>
                      Estado
                      <select
                        value={initialStatus}
                        onChange={(e) =>
                          setInitialStatus(e.target.value as 'PENDING' | 'CONFIRMED')
                        }
                      >
                        <option value="PENDING">Pendente</option>
                        <option value="CONFIRMED">Confirmada</option>
                      </select>
                    </label>
                  </div>
                  <p className={'agenda-availability ' + (available ? 'yes' : 'no')} role="status">
                    {available === null
                      ? 'Verificando disponibilidade…'
                      : available
                        ? `Disponível · ${price === null ? 'Preço indisponível' : money(price)}`
                        : 'Horário indisponível'}
                  </p>
                  <button
                    disabled={busy || !available || !customerId || !venueId}
                    className="agenda-primary"
                  >
                    {busy ? 'Salvando…' : 'Criar reserva'}
                  </button>
                </form>
              )}
              {can('schedule_blocks.manage') && (
                <details className="agenda-monthly">
                  <summary>Bloquear espaço</summary>
                  <form
                    className="agenda-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const reason = String(
                        new FormData(event.currentTarget).get('reason') ?? '',
                      ).trim();
                      void mutate(
                        () =>
                          call(
                            '/blocks',
                            'POST',
                            { venueId, date: day, startTime, durationMinutes: duration, reason },
                            randomKey(),
                          ),
                        'Espaço bloqueado.',
                      );
                    }}
                  >
                    <p>Usa o espaço, data e horário selecionados acima.</p>
                    <label>
                      Motivo
                      <input name="reason" required maxLength={500} />
                    </label>
                    <button className="agenda-primary" disabled={busy || !venueId}>
                      Bloquear
                    </button>
                  </form>
                </details>
              )}
            </section>
          )}
          {(can('recurrences.read') || can('recurrences.manage')) && (
            <section className="agenda-panel">
              <h2>Mensalistas</h2>
              <p>{conflicts.length} conflito(s) para analisar.</p>
              {conflicts.slice(0, 5).map((x) => (
                <div key={x.id} className="agenda-conflict">
                  <strong>{labelDate(x.occurrence_date)}</strong> · {x.reason}
                  {can('recurrences.manage') && (
                    <div className="agenda-conflict-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            async () => {
                              await call(
                                `/recurrence-conflicts/${x.id}/resolve`,
                                'POST',
                                { action: 'RETRY' },
                                randomKey(),
                              );
                            },
                            'Ocorrência reavaliada.',
                            true,
                          )
                        }
                      >
                        Tentar de novo
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const reason = prompt('Por que dispensar esta ocorrência?');
                          if (!reason) return;
                          void mutate(
                            async () => {
                              await call(
                                `/recurrence-conflicts/${x.id}/resolve`,
                                'POST',
                                { action: 'SKIP', reason },
                                randomKey(),
                              );
                            },
                            'Ocorrência dispensada.',
                            true,
                          );
                        }}
                      >
                        Dispensar
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const date = prompt('Nova data (AAAA-MM-DD)', x.occurrence_date);
                          const time = prompt('Novo horário (HH:MM)', startTime);
                          const reason = prompt('Motivo da alteração');
                          if (!date || !time || !reason) return;
                          void mutate(
                            async () => {
                              await call(
                                `/recurrence-conflicts/${x.id}/resolve`,
                                'POST',
                                {
                                  action: 'MOVE',
                                  date,
                                  startTime: time,
                                  durationMinutes: duration,
                                  reason,
                                },
                                randomKey(),
                              );
                            },
                            'Ocorrência movida.',
                            true,
                          );
                        }}
                      >
                        Outro horário
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {can('recurrences.manage') && (
                <details className="agenda-monthly">
                  <summary>Novo contrato mensal</summary>
                  <form className="agenda-form" onSubmit={createRecurrence}>
                    <p>Usa o cliente, espaço, modalidade e duração selecionados acima.</p>
                    <label>
                      Início
                      <input
                        type="date"
                        value={recurrenceStart}
                        onChange={(e) => setRecurrenceStart(e.target.value)}
                      />
                    </label>
                    <fieldset>
                      <legend>Dias da semana</legend>
                      {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label, weekday) => (
                        <label key={weekday} className="agenda-weekday">
                          <input
                            type="checkbox"
                            checked={recurrenceDays.includes(weekday)}
                            onChange={(e) =>
                              setRecurrenceDays((old) =>
                                e.target.checked
                                  ? [...old, weekday].sort()
                                  : old.filter((n) => n !== weekday),
                              )
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      Valor por ocorrência (R$)
                      <input
                        value={recurrencePrice}
                        onChange={(e) => setRecurrencePrice(e.target.value)}
                      />
                    </label>
                    <label>
                      Mensalidade (R$)
                      <input
                        value={monthlyAmount}
                        onChange={(e) => setMonthlyAmount(e.target.value)}
                      />
                    </label>
                    {recurrenceDays.length > 0 &&
                      firstMonthPreviewKey === firstMonthInputKey &&
                      !firstMonthPreviewError &&
                      firstMonthPreview !== null && (
                        <p role="status">
                          Estimativa do primeiro mês: {money(firstMonthPreview)}. Confirmada ao
                          criar o contrato.
                        </p>
                      )}
                    {firstMonthPreviewKey === firstMonthInputKey && firstMonthPreviewError && (
                      <p role="alert">{firstMonthPreviewError}</p>
                    )}
                    <button
                      className="agenda-primary"
                      disabled={busy || !customerId || !venueId || !recurrenceDays.length}
                    >
                      Criar mensalista
                    </button>
                  </form>
                </details>
              )}
            </section>
          )}
        </div>
      </div>
      {can('recurrences.read') && (
        <section className="agenda-contracts">
          <div className="agenda-contracts-head">
            <div>
              <span className="agenda-kicker">CONTRATOS</span>
              <h2>Administração de mensalistas</h2>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void call('/recurrence-contracts?search=' + encodeURIComponent(contractSearch))
                  .then((rows) => {
                    setContracts(rows);
                    setSelectedContract(null);
                    setContractEdit(null);
                  })
                  .catch((e) => setError((e as Error).message));
              }}
            >
              <label>
                Buscar cliente ou espaço
                <input value={contractSearch} onChange={(e) => setContractSearch(e.target.value)} />
              </label>
              <button type="submit">Buscar</button>
            </form>
          </div>
          <div className="agenda-contracts-grid">
            <div className="agenda-contract-list">
              {contracts.length === 0 && <p>Nenhum contrato encontrado.</p>}
              {contracts.map((contract) => (
                <button
                  key={contract.recurrence_id}
                  className={
                    selectedContract?.recurrence_id === contract.recurrence_id ? 'selected' : ''
                  }
                  onClick={() => void selectContract(contract)}
                >
                  <strong>{contract.customer_name}</strong>
                  <span>
                    {contract.venue_name} · {contract.status === 'ACTIVE' ? 'Ativo' : 'Encerrado'}
                  </span>
                  <small>
                    {contract.starts_on} {contract.ends_on ? `→ ${contract.ends_on}` : '→ contínuo'}{' '}
                    · {contract.future_count} futuras · {contract.conflict_count} conflitos
                  </small>
                </button>
              ))}
            </div>
            {selectedContract && (
              <div className="agenda-contract-detail">
                <h3>{selectedContract.customer_name}</h3>
                <p>
                  {selectedContract.venue_name} ·{' '}
                  {selectedContract.billing_mode === 'MONTHLY' ? 'Mensal' : 'Por ocorrência'} ·{' '}
                  {selectedContract.status}
                </p>
                <p>
                  Vigência: {selectedContract.starts_on} —{' '}
                  {selectedContract.ends_on ?? 'sem data final'}
                </p>
                <p>
                  Valor por ocorrência: {money(Number(selectedContract.price_cents))} · Mensalidade:{' '}
                  {selectedContract.monthly_amount_cents
                    ? money(Number(selectedContract.monthly_amount_cents))
                    : 'não aplicável'}
                </p>
                <p>
                  {selectedContract.future_count} ocorrências futuras ·{' '}
                  {selectedContract.conflict_count} conflitos
                </p>
                <ul>
                  {selectedContract.rules.map((rule) => (
                    <li key={rule.weekday}>
                      {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][rule.weekday]} às{' '}
                      {rule.startTime} · {rule.durationMinutes} min
                    </li>
                  ))}
                </ul>
                <details className="agenda-contract-history">
                  <summary>Histórico do contrato</summary>
                  <ol>
                    {contractHistory.map((entry) => (
                      <li key={entry.id}>
                        {new Date(entry.created_at).toLocaleString('pt-BR', { timeZone: timezone })}{' '}
                        · {entry.action}
                      </li>
                    ))}
                  </ol>
                </details>
                {can('recurrences.manage') &&
                  selectedContract.status === 'ACTIVE' &&
                  contractEdit && (
                    <>
                      <form
                        className="agenda-contract-edit"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void mutate(
                            () =>
                              call(
                                `/recurrence-contracts/${selectedContract.id}/versions`,
                                'POST',
                                {
                                  venueId: contractEdit.venueId,
                                  sportId: contractEdit.sportId,
                                  effectiveFrom: contractEdit.effectiveFrom,
                                  endsOn: contractEdit.endsOn || null,
                                  priceCents: cents(contractEdit.price),
                                  monthlyAmountCents:
                                    selectedContract.billing_mode === 'MONTHLY'
                                      ? cents(contractEdit.monthly)
                                      : null,
                                  rules: contractEdit.rules,
                                },
                                randomKey(),
                              ),
                            'Nova versão do contrato criada.',
                            true,
                          ).then((ok) => {
                            if (ok)
                              setContractEdit({
                                ...contractEdit,
                                effectiveFrom: addDays(contractEdit.effectiveFrom, 7),
                              });
                          });
                        }}
                      >
                        <h4>Alterar próxima vigência</h4>
                        <label>
                          Início da nova versão
                          <input
                            required
                            type="date"
                            value={contractEdit.effectiveFrom}
                            onChange={(e) =>
                              setContractEdit({ ...contractEdit, effectiveFrom: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Fim da nova versão
                          <input
                            type="date"
                            value={contractEdit.endsOn}
                            onChange={(e) =>
                              setContractEdit({ ...contractEdit, endsOn: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Espaço
                          <select
                            value={contractEdit.venueId}
                            onChange={(e) =>
                              setContractEdit({ ...contractEdit, venueId: e.target.value })
                            }
                          >
                            {venues.map((venue) => (
                              <option key={venue.id} value={venue.id}>
                                {venue.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Modalidade
                          <select
                            value={contractEdit.sportId ?? ''}
                            onChange={(e) =>
                              setContractEdit({ ...contractEdit, sportId: e.target.value || null })
                            }
                          >
                            <option value="">Sem modalidade</option>
                            {sports
                              .filter((sport) =>
                                venues
                                  .find((venue) => venue.id === contractEdit.venueId)
                                  ?.sport_ids.includes(sport.id),
                              )
                              .map((sport) => (
                                <option key={sport.id} value={sport.id}>
                                  {sport.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Valor por ocorrência (R$)
                          <input
                            required
                            value={contractEdit.price}
                            onChange={(e) =>
                              setContractEdit({ ...contractEdit, price: e.target.value })
                            }
                          />
                        </label>
                        {selectedContract.billing_mode === 'MONTHLY' && (
                          <label>
                            Mensalidade (R$)
                            <input
                              required
                              value={contractEdit.monthly}
                              onChange={(e) =>
                                setContractEdit({ ...contractEdit, monthly: e.target.value })
                              }
                            />
                          </label>
                        )}
                        <fieldset>
                          <legend>Frequência</legend>
                          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(
                            (label, weekday) => {
                              const rule = contractEdit.rules.find(
                                (value) => value.weekday === weekday,
                              );
                              return (
                                <div key={weekday} className="agenda-contract-rule">
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={!!rule}
                                      onChange={(e) =>
                                        setContractEdit({
                                          ...contractEdit,
                                          rules: e.target.checked
                                            ? [
                                                ...contractEdit.rules,
                                                {
                                                  weekday,
                                                  startTime: '18:00',
                                                  durationMinutes: 60,
                                                },
                                              ].sort((a, b) => a.weekday - b.weekday)
                                            : contractEdit.rules.filter(
                                                (value) => value.weekday !== weekday,
                                              ),
                                        })
                                      }
                                    />
                                    {label}
                                  </label>
                                  {rule && (
                                    <>
                                      <input
                                        aria-label={`Horário ${label}`}
                                        type="time"
                                        step="900"
                                        value={rule.startTime}
                                        onChange={(e) =>
                                          setContractEdit({
                                            ...contractEdit,
                                            rules: contractEdit.rules.map((value) =>
                                              value.weekday === weekday
                                                ? { ...value, startTime: e.target.value }
                                                : value,
                                            ),
                                          })
                                        }
                                      />
                                      <input
                                        aria-label={`Duração ${label}`}
                                        type="number"
                                        min={1}
                                        max={1440}
                                        value={rule.durationMinutes}
                                        onChange={(e) =>
                                          setContractEdit({
                                            ...contractEdit,
                                            rules: contractEdit.rules.map((value) =>
                                              value.weekday === weekday
                                                ? {
                                                    ...value,
                                                    durationMinutes: Number(e.target.value),
                                                  }
                                                : value,
                                            ),
                                          })
                                        }
                                      />
                                    </>
                                  )}
                                </div>
                              );
                            },
                          )}
                        </fieldset>
                        <button type="submit" disabled={busy || !contractEdit.rules.length}>
                          Criar nova versão
                        </button>
                      </form>
                      <button
                        className="agenda-end-contract"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              'Encerrar o contrato? Ocorrências futuras serão canceladas conforme a política do sistema.',
                            )
                          )
                            return;
                          void mutate(
                            () =>
                              call(
                                `/recurrence-contracts/${selectedContract.id}/end`,
                                'POST',
                                {},
                                randomKey(),
                              ),
                            'Contrato encerrado.',
                            true,
                          );
                        }}
                      >
                        Encerrar contrato
                      </button>
                    </>
                  )}
              </div>
            )}
          </div>
        </section>
      )}
      {selected && (
        <div
          className="agenda-dialog-backdrop"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <section
            className="agenda-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes da reserva"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="agenda-close" onClick={() => setSelected(null)} aria-label="Fechar">
              ×
            </button>
            <span className="agenda-kicker">RESERVA</span>
            <h2>{selected.customer_name}</h2>
            <p>
              ID: <code>{selected.id}</code>
            </p>
            <p>
              Espaço: {venues.find((v) => v.id === selected.venue_id)?.name ?? selected.venue_id}
            </p>
            <p>
              Modalidade: {sports.find((s) => s.id === selected.sport_id)?.name ?? 'Não informada'}
            </p>
            <p>
              {new Date(selected.start_at).toLocaleString('pt-BR', { timeZone: timezone })} —{' '}
              {hour(selected.end_at, timezone)}
            </p>
            <p>
              {statusLabel[selected.status]} · {money(selected.price_cents)}
            </p>
            <p>{selected.source === 'IN_PERSON' ? 'Atendimento presencial' : 'Administrativa'}</p>
            {selected.notes && <p>Observações: {selected.notes}</p>}
            <div className="agenda-actions">
              {selected.status === 'PENDING' && can('reservations.confirm') && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        call(
                          `/reservations/${selected.id}/confirm`,
                          'POST',
                          { expectedVersion: selected.version },
                          randomKey(),
                        ),
                      'Reserva confirmada.',
                    )
                  }
                >
                  Confirmar
                </button>
              )}
              {['PENDING', 'CONFIRMED'].includes(selected.status) && can('reservations.cancel') && (
                <button disabled={busy} onClick={() => void openCancellation()}>
                  Cancelar
                </button>
              )}
              {['PENDING', 'CONFIRMED'].includes(selected.status) &&
                !selected.recurrence_id &&
                can('reservations.reschedule') && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setActionMode('reschedule');
                      setRescheduleDate(selected.local_date);
                      setRescheduleTime(hour(selected.start_at, timezone));
                      setRescheduleVenue(selected.venue_id);
                      setRescheduleDuration(
                        Math.round(
                          (new Date(selected.end_at).getTime() -
                            new Date(selected.start_at).getTime()) /
                            60000,
                        ),
                      );
                      setReschedulePreview(null);
                    }}
                  >
                    Remarcar
                  </button>
                )}
              {selected.status === 'CONFIRMED' &&
                new Date(selected.end_at).getTime() <= clockNow &&
                can('reservations.complete') && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          call(
                            `/reservations/${selected.id}/complete`,
                            'POST',
                            { expectedVersion: selected.version },
                            randomKey(),
                          ),
                        'Reserva concluída.',
                      )
                    }
                  >
                    Concluir
                  </button>
                )}
              {selected.status === 'CONFIRMED' &&
                new Date(selected.start_at).getTime() <= clockNow &&
                can('reservations.no_show') && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          call(
                            `/reservations/${selected.id}/no_show`,
                            'POST',
                            { expectedVersion: selected.version },
                            randomKey(),
                          ),
                        'Não comparecimento registrado.',
                      )
                    }
                  >
                    Não compareceu
                  </button>
                )}
            </div>
            {actionMode === 'cancel' && cancellationPreview && (
              <form
                className="agenda-action-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(
                    () =>
                      call(
                        `/reservations/${selected.id}/cancel`,
                        'POST',
                        {
                          expectedVersion: selected.version,
                          reason: cancelReason,
                          waiveFee,
                        },
                        randomKey(),
                      ),
                    'Reserva cancelada.',
                  ).then((ok) => {
                    if (ok) setActionMode(null);
                  });
                }}
              >
                <h3>Revisar cancelamento</h3>
                <p>Valor contratado: {money(cancellationPreview.originalPriceCents)}</p>
                <p>
                  Antecedência: {Math.floor(cancellationPreview.leadSeconds / 3600)} h · Política V
                  {cancellationPreview.policyVersion}: {cancellationPreview.policyPercent}%
                </p>
                <p>
                  Obrigação após cancelamento: {money(waiveFee ? 0 : cancellationPreview.feeCents)}
                </p>
                <p>{cancellationPreview.note} O horário será liberado após a confirmação.</p>
                {can('commercial_policy.override') && (
                  <label className="agenda-check">
                    <input
                      type="checkbox"
                      checked={waiveFee}
                      onChange={(e) => setWaiveFee(e.target.checked)}
                    />{' '}
                    Isentar por exceção autorizada
                  </label>
                )}
                <label>
                  Motivo
                  <input
                    required
                    maxLength={500}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                </label>
                <button type="submit" disabled={busy || !cancelReason.trim()}>
                  Confirmar cancelamento
                </button>
                <button type="button" onClick={() => setActionMode(null)}>
                  Voltar
                </button>
              </form>
            )}
            {actionMode === 'reschedule' && (
              <form
                className="agenda-action-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!reschedulePreview?.available) return;
                  void mutate(
                    () =>
                      call(
                        `/reservations/${selected.id}/reschedule`,
                        'POST',
                        {
                          venueId: rescheduleVenue,
                          sportId: selected.sport_id,
                          date: rescheduleDate,
                          startTime: rescheduleTime,
                          durationMinutes: rescheduleDuration,
                          expectedVersion: selected.version,
                        },
                        randomKey(),
                      ),
                    'Reserva remarcada.',
                  ).then((ok) => {
                    if (ok) setActionMode(null);
                  });
                }}
              >
                <h3>Revisar remarcação</h3>
                <p>
                  Original: {selected.local_date} {hour(selected.start_at, timezone)} ·{' '}
                  {money(selected.price_cents)}
                </p>
                <label>
                  Novo espaço
                  <select
                    value={rescheduleVenue}
                    onChange={(e) => {
                      setRescheduleVenue(e.target.value);
                      setReschedulePreview(null);
                    }}
                  >
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nova data
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => {
                      setRescheduleDate(e.target.value);
                      setReschedulePreview(null);
                    }}
                  />
                </label>
                <label>
                  Novo horário
                  <input
                    type="time"
                    step="900"
                    value={rescheduleTime}
                    onChange={(e) => {
                      setRescheduleTime(e.target.value);
                      setReschedulePreview(null);
                    }}
                  />
                </label>
                <label>
                  Duração (min)
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={rescheduleDuration}
                    onChange={(e) => {
                      setRescheduleDuration(Number(e.target.value));
                      setReschedulePreview(null);
                    }}
                  />
                </label>
                <button type="button" onClick={() => void checkReschedule()}>
                  Verificar novo horário
                </button>
                {reschedulePreview && (
                  <p>
                    {reschedulePreview.available ? 'Disponível' : 'Horário ocupado'} · Novo valor:{' '}
                    {money(reschedulePreview.newPriceCents)} · Diferença:{' '}
                    {money(reschedulePreview.differenceCents)}
                  </p>
                )}
                <button type="submit" disabled={busy || !reschedulePreview?.available}>
                  Confirmar remarcação
                </button>
                <button type="button" onClick={() => setActionMode(null)}>
                  Voltar
                </button>
              </form>
            )}
            <details className="agenda-history">
              <summary>Histórico</summary>
              <ol>
                {history.map((entry) => (
                  <li key={entry.id}>
                    {new Date(entry.created_at).toLocaleString('pt-BR', { timeZone: timezone })} ·{' '}
                    {entry.action} · {entry.from_status ?? '—'} → {entry.to_status ?? '—'}
                  </li>
                ))}
              </ol>
            </details>
          </section>
        </div>
      )}
      <p className={'agenda-notice ' + (error ? 'error' : 'success')} role="status">
        {error || notice}
      </p>
    </main>
  );
}

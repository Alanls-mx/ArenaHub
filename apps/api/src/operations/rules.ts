import { commercialTime, civilDate } from '../shared/time/index.js';

export type Shift = { weekday: number; openTime: string; closeTime: string; spansFullDay: boolean };
export const minute = (time: string) => {
  const t = commercialTime(time);
  if (t.second || t.millisecond || t.microsecond || t.nanosecond)
    throw RangeError('Horário inválido');
  return t.hour * 60 + t.minute;
};
export function validateShifts(shifts: Shift[]) {
  const week = 7 * 1440;
  const intervals = shifts.map((s) => {
    const start = s.weekday * 1440 + minute(s.openTime);
    const close = minute(s.closeTime);
    if ((close === minute(s.openTime)) !== s.spansFullDay)
      throw RangeError('Turno contínuo inválido');
    return { start, end: s.weekday * 1440 + close + (close <= minute(s.openTime) ? 1440 : 0) };
  });
  for (let i = 0; i < intervals.length; i++)
    for (let j = i + 1; j < intervals.length; j++)
      for (const offset of [-week, 0, week]) {
        const a = intervals[i]!,
          b = intervals[j]!;
        if (a.start < b.end + offset && b.start + offset < a.end)
          throw RangeError('Turnos sobrepostos');
      }
}

export type PriceRule = {
  id: string;
  sportId: string | null;
  specificDate: string | null;
  weekday: number | null;
  startMinute: number;
  endMinute: number;
  pricePerHourCents: number;
  validFrom: string | null;
  validUntil: string | null;
};
export function overlap(
  a: Omit<PriceRule, 'id' | 'pricePerHourCents'>,
  b: Omit<PriceRule, 'id' | 'pricePerHourCents'>,
) {
  if (a.sportId !== b.sportId || a.specificDate !== b.specificDate || a.weekday !== b.weekday)
    return false;
  if (a.endMinute <= b.startMinute || b.endMinute <= a.startMinute) return false;
  if (a.specificDate) return true;
  return (
    (a.validFrom ?? '0001-01-01') <= (b.validUntil ?? '9999-12-31') &&
    (b.validFrom ?? '0001-01-01') <= (a.validUntil ?? '9999-12-31')
  );
}
export function quote(input: {
  date: string;
  startTime: string;
  durationMinutes: number;
  sportId?: string | undefined;
  defaultPricePerHourCents: number | null;
  rules: PriceRule[];
}) {
  const origin = civilDate(input.date).toPlainDateTime(commercialTime(input.startTime));
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 ||
    input.durationMinutes > 1440
  )
    throw RangeError('Duração inválida');
  const segments: {
    from: string;
    to: string;
    ruleId: string | null;
    pricePerHourCents: number;
    minutes: number;
  }[] = [];
  let numerator = 0n;
  for (let i = 0; i < input.durationMinutes; i++) {
    const at = origin.add({ minutes: i });
    const date = at.toPlainDate().toString();
    const weekday = at.dayOfWeek % 7;
    const m = at.hour * 60 + at.minute;
    const matches = input.rules.filter(
      (r) =>
        m >= r.startMinute &&
        m < r.endMinute &&
        (!r.sportId || r.sportId === input.sportId) &&
        (r.specificDate
          ? r.specificDate === date
          : r.weekday === weekday &&
            (!r.validFrom || date >= r.validFrom) &&
            (!r.validUntil || date <= r.validUntil)),
    );
    matches.sort((a, b) => {
      const level = (r: PriceRule) => (r.specificDate ? 1 : r.sportId ? 2 : 3);
      return (
        level(a) - level(b) || Number(!!b.sportId) - Number(!!a.sportId) || a.id.localeCompare(b.id)
      );
    });
    const chosen = matches[0];
    const price = chosen?.pricePerHourCents ?? input.defaultPricePerHourCents;
    if (price == null)
      return { available: false as const, reason: 'PRICE_UNAVAILABLE' as const, segments };
    if (!Number.isSafeInteger(price) || price < 0) throw RangeError('Preço inválido');
    numerator += BigInt(price);
    const from = at.toString({ smallestUnit: 'minute' });
    const to = at.add({ minutes: 1 }).toString({ smallestUnit: 'minute' });
    const last = segments.at(-1);
    if (
      last &&
      last.ruleId === (chosen?.id ?? null) &&
      last.pricePerHourCents === price &&
      last.from.slice(0, 10) === date &&
      last.to === from
    ) {
      last.to = to;
      last.minutes++;
    } else
      segments.push({ from, to, ruleId: chosen?.id ?? null, pricePerHourCents: price, minutes: 1 });
  }
  const total = (numerator + 30n) / 60n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw RangeError('Preço excessivo');
  return { available: true as const, totalCents: Number(total), segments };
}

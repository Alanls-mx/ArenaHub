import { Temporal } from '@js-temporal/polyfill';

export type AmbiguousTimeChoice = 'earlier' | 'later';

export function validateTimeZone(zone: string): string {
  try {
    if (zone !== 'UTC' && !zone.includes('/')) throw new RangeError();
    Temporal.Now.zonedDateTimeISO(zone);
    return zone;
  } catch {
    throw new RangeError(`Fuso IANA inválido: ${zone}`);
  }
}

export function civilDate(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value);
}

export function commercialTime(value: string): Temporal.PlainTime {
  return Temporal.PlainTime.from(value);
}

export function localToInstant(
  local: string,
  zone: string,
  choice?: AmbiguousTimeChoice,
): Temporal.Instant {
  validateTimeZone(zone);
  const dateTime = Temporal.PlainDateTime.from(local);
  const earlier = dateTime.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const later = dateTime.toZonedDateTime(zone, { disambiguation: 'later' });
  if (
    earlier.toPlainDateTime().toString() !== dateTime.toString() ||
    later.toPlainDateTime().toString() !== dateTime.toString()
  ) {
    throw new RangeError('INVALID_LOCAL_TIME');
  }
  if (earlier.epochNanoseconds !== later.epochNanoseconds && !choice) {
    throw new RangeError('AMBIGUOUS_LOCAL_TIME');
  }
  return (choice === 'later' ? later : earlier).toInstant();
}

export function instantToLocal(
  instant: string | Temporal.Instant,
  zone: string,
): Temporal.PlainDateTime {
  validateTimeZone(zone);
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime();
}

export function instantWithOffset(value: string): Temporal.Instant {
  return Temporal.ZonedDateTime.from(value, { offset: 'reject' }).toInstant();
}

export function operationalWindow(
  date: string,
  opening: string,
  closing: string,
  zone: string,
  continuous = false,
): { start: Temporal.Instant; end: Temporal.Instant } {
  const day = civilDate(date);
  const open = commercialTime(opening);
  const close = commercialTime(closing);
  const start = localToInstant(day.toPlainDateTime(open).toString(), zone);
  const nextDay = Temporal.PlainTime.compare(close, open) <= 0;
  if (Temporal.PlainTime.compare(close, open) === 0 && !continuous) {
    throw new RangeError('Horários iguais exigem funcionamento contínuo explícito');
  }
  const endDate = nextDay ? day.add({ days: 1 }) : day;
  const end = localToInstant(endDate.toPlainDateTime(close).toString(), zone);
  return { start, end };
}

export function overlaps(
  a: { start: Temporal.Instant; end: Temporal.Instant },
  b: { start: Temporal.Instant; end: Temporal.Instant },
): boolean {
  if (
    Temporal.Instant.compare(a.start, a.end) >= 0 ||
    Temporal.Instant.compare(b.start, b.end) >= 0
  ) {
    throw new RangeError('Intervalo inválido');
  }
  return (
    Temporal.Instant.compare(a.start, b.end) < 0 && Temporal.Instant.compare(b.start, a.end) < 0
  );
}

export function durationMinutes(start: Temporal.Instant, end: Temporal.Instant): number {
  if (Temporal.Instant.compare(start, end) > 0) throw new RangeError('Intervalo inválido');
  return start.until(end).total({ unit: 'minute' });
}

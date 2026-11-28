import { Temporal } from '@js-temporal/polyfill';

export function firstMonthAmount(
  monthlyAmountCents: number,
  startsOn: string,
  weekdays: number[],
): number {
  if (
    !Number.isSafeInteger(monthlyAmountCents) ||
    monthlyAmountCents < 0 ||
    !weekdays.length ||
    new Set(weekdays).size !== weekdays.length ||
    weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw RangeError('Contrato inválido');
  const start = Temporal.PlainDate.from(startsOn);
  const first = start.with({ day: 1 });
  const last = first.add({ months: 1 }).subtract({ days: 1 });
  let total = 0,
    remaining = 0;
  for (let day = first; Temporal.PlainDate.compare(day, last) <= 0; day = day.add({ days: 1 })) {
    if (weekdays.includes(day.dayOfWeek % 7)) {
      total++;
      if (Temporal.PlainDate.compare(day, start) >= 0) remaining++;
    }
  }
  if (!total) return 0;
  return Number(
    (BigInt(monthlyAmountCents) * BigInt(remaining) + BigInt(Math.floor(total / 2))) /
      BigInt(total),
  );
}

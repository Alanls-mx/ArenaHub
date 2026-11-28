import { describe, expect, it } from 'vitest';
import { overlap, quote, validateShifts } from './rules.js';

describe('estrutura temporal e preços puros', () => {
  it('recusa turnos que colidem depois da meia-noite e aceita 24 horas', () => {
    expect(() =>
      validateShifts([
        { weekday: 0, openTime: '22:00', closeTime: '02:00', spansFullDay: false },
        { weekday: 1, openTime: '01:00', closeTime: '04:00', spansFullDay: false },
      ]),
    ).toThrow();
    expect(() =>
      validateShifts([{ weekday: 0, openTime: '00:00', closeTime: '00:00', spansFullDay: true }]),
    ).not.toThrow();
    expect(() =>
      validateShifts([
        { weekday: 6, openTime: '23:00', closeTime: '02:00', spansFullDay: false },
        { weekday: 0, openTime: '01:00', closeTime: '03:00', spansFullDay: false },
      ]),
    ).toThrow();
  });
  it('aplica precedência e arredonda apenas ao final', () => {
    const result = quote({
      date: '2026-11-24',
      startTime: '18:30',
      durationMinutes: 60,
      defaultPricePerHourCents: 5000,
      rules: [
        {
          id: 'a',
          sportId: null,
          specificDate: null,
          weekday: 2,
          startMinute: 18 * 60,
          endMinute: 19 * 60,
          pricePerHourCents: 8000,
          validFrom: null,
          validUntil: null,
        },
        {
          id: 'b',
          sportId: null,
          specificDate: null,
          weekday: 2,
          startMinute: 19 * 60,
          endMinute: 20 * 60,
          pricePerHourCents: 10000,
          validFrom: null,
          validUntil: null,
        },
      ],
    });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.totalCents).toBe(9000);
      expect(result.segments).toHaveLength(2);
    }
    const missing = quote({
      date: '2026-11-24',
      startTime: '18:00',
      durationMinutes: 60,
      defaultPricePerHourCents: null,
      rules: [],
    });
    expect(missing.available).toBe(false);
  });
  it('detecta sobreposição apenas no mesmo escopo e vigência', () => {
    const a = {
      sportId: null,
      specificDate: null,
      weekday: 2,
      startMinute: 600,
      endMinute: 720,
      validFrom: '2026-01-01',
      validUntil: '2026-06-30',
    };
    expect(overlap(a, { ...a, startMinute: 700, endMinute: 800 })).toBe(true);
    expect(overlap(a, { ...a, startMinute: 720, endMinute: 800 })).toBe(false);
    expect(overlap(a, { ...a, validFrom: '2026-07-01' })).toBe(false);
    expect(overlap(a, { ...a, sportId: 'sport' })).toBe(false);
  });
  it('prioriza data e modalidade e separa trechos na virada local', () => {
    const base = { startMinute: 0, endMinute: 1440, validFrom: null, validUntil: null };
    const result = quote({
      date: '2026-11-24',
      startTime: '23:30',
      durationMinutes: 60,
      sportId: 'beach',
      defaultPricePerHourCents: 5000,
      rules: [
        {
          ...base,
          id: 'day',
          sportId: null,
          specificDate: '2026-11-24',
          weekday: null,
          pricePerHourCents: 8000,
        },
        {
          ...base,
          id: 'sport',
          sportId: 'beach',
          specificDate: '2026-11-24',
          weekday: null,
          pricePerHourCents: 10000,
        },
        {
          ...base,
          id: 'next',
          sportId: null,
          specificDate: '2026-11-25',
          weekday: null,
          pricePerHourCents: 6000,
        },
      ],
    });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.totalCents).toBe(8000);
      expect(result.segments.map((s) => s.ruleId)).toEqual(['sport', 'next']);
    }
  });
});

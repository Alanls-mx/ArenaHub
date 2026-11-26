import { describe, expect, it } from 'vitest';
import {
  civilDate,
  durationMinutes,
  instantToLocal,
  instantWithOffset,
  localToInstant,
  operationalWindow,
  overlaps,
  validateTimeZone,
} from './index.js';

describe('tempo local e instantes', () => {
  it('preserva datas civis e horários locais em fusos distintos', () => {
    expect(civilDate('2028-02-29').toString()).toBe('2028-02-29');
    expect(localToInstant('2028-02-29T18:00', 'America/Sao_Paulo').toString()).toBe(
      '2028-02-29T21:00:00Z',
    );
    expect(localToInstant('2028-02-29T18:00', 'America/Manaus').toString()).toBe(
      '2028-02-29T22:00:00Z',
    );
    expect(instantToLocal('2028-02-29T21:00:00Z', 'America/Sao_Paulo').toString()).toBe(
      '2028-02-29T18:00:00',
    );
    expect(validateTimeZone('UTC')).toBe('UTC');
    expect(() => validateTimeZone('Not/AZone')).toThrow();
  });

  it('exige escolha em horário ambíguo e recusa horário inexistente', () => {
    expect(() => localToInstant('2027-11-07T01:30', 'America/New_York')).toThrow(
      'AMBIGUOUS_LOCAL_TIME',
    );
    expect(localToInstant('2027-11-07T01:30', 'America/New_York', 'earlier').toString()).toBe(
      '2027-11-07T05:30:00Z',
    );
    expect(localToInstant('2027-11-07T01:30', 'America/New_York', 'later').toString()).toBe(
      '2027-11-07T06:30:00Z',
    );
    expect(() => localToInstant('2027-03-14T02:30', 'America/New_York')).toThrow(
      'INVALID_LOCAL_TIME',
    );
  });

  it('calcula funcionamento após meia-noite e contínuo', () => {
    const overnight = operationalWindow('2027-12-31', '18:00', '02:00', 'America/Sao_Paulo');
    expect(durationMinutes(overnight.start, overnight.end)).toBe(480);
    expect(instantToLocal(overnight.end, 'America/Sao_Paulo').toString()).toBe(
      '2028-01-01T02:00:00',
    );
    expect(() => operationalWindow('2027-01-01', '18:00', '18:00', 'UTC')).toThrow();
    const continuous = operationalWindow('2027-01-01', '18:00', '18:00', 'UTC', true);
    expect(durationMinutes(continuous.start, continuous.end)).toBe(1440);
  });

  it('compara intervalos semiabertos e valida offset explícito', () => {
    const a = operationalWindow('2027-01-01', '18:00', '19:00', 'UTC');
    const b = operationalWindow('2027-01-01', '19:00', '20:00', 'UTC');
    expect(overlaps(a, b)).toBe(false);
    expect(instantWithOffset('2027-01-01T18:00-03:00[America/Sao_Paulo]').toString()).toBe(
      '2027-01-01T21:00:00Z',
    );
    expect(() => instantWithOffset('2027-01-01T18:00-05:00[America/Sao_Paulo]')).toThrow();
  });
});

import { expect, it } from 'vitest';
import { firstMonthAmount } from './recurrence.js';

it('prorrateia pelo número de ocorrências contratadas, com arredondamento determinístico', () => {
  expect(firstMonthAmount(10001, '2026-12-01', [2])).toBe(10001);
  expect(firstMonthAmount(10001, '2026-12-16', [2])).toBe(4000);
  expect(firstMonthAmount(10001, '2026-12-31', [2])).toBe(0);
  expect(firstMonthAmount(10001, '2026-12-16', [2, 4])).toBe(5001);
});

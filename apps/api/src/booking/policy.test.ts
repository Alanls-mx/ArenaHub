import { describe, expect, it } from 'vitest';
import { cancellationAmount, noShowAmount } from './policy.js';

describe('política comercial central V1', () => {
  const start = new Date('2026-12-10T18:00:00Z');
  it('aplica 0% no limite exato de 24h e 50% depois', () => {
    expect(cancellationAmount(101, start, new Date('2026-12-09T18:00:00Z'))).toBe(0);
    expect(cancellationAmount(101, start, new Date('2026-12-09T18:00:01Z'))).toBe(51);
  });
  it('limita no-show a 100% do preço contratado', () => {
    expect(noShowAmount(101)).toBe(101);
  });
});

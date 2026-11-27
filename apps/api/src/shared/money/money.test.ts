import { describe, expect, it } from 'vitest';
import { add, cents, formatBRL, multiplyRatio, serialize, subtract } from './index.js';

describe('BRL em centavos', () => {
  it('valida inteiro seguro, sinal e limites', () => {
    expect(cents(0)).toBe(0);
    expect(cents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => cents(value)).toThrow();
    }
  });

  it('calcula sem intermediário de ponto flutuante', () => {
    expect(add(cents(100), cents(25))).toBe(125);
    expect(subtract(cents(100), cents(25))).toBe(75);
    expect(multiplyRatio(cents(101), 1n, 2n)).toBe(51);
    expect(() => add(cents(Number.MAX_SAFE_INTEGER), cents(1))).toThrow('Overflow');
  });

  it('separa representação de domínio e visual', () => {
    expect(serialize(cents(12345))).toBe(12345);
    expect(formatBRL(cents(12345))).toContain('123,45');
    expect(formatBRL(cents(Number.MAX_SAFE_INTEGER))).toContain('90.071.992.547.409,91');
    expect(formatBRL(cents(-12345, true))).toContain('-R$');
  });
});

export type Cents = number & { readonly __brand: 'BRL cents' };
const max = BigInt(Number.MAX_SAFE_INTEGER);

export function cents(value: number, allowNegative = false): Cents {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new RangeError('Valor em centavos inválido');
  }
  return value as Cents;
}

function checked(value: bigint, allowNegative = false): Cents {
  if (value > max || value < -max) throw new RangeError('Overflow monetário');
  return cents(Number(value), allowNegative);
}

export function add(a: Cents, b: Cents): Cents {
  return checked(BigInt(a) + BigInt(b), true);
}

export function subtract(a: Cents, b: Cents): Cents {
  return checked(BigInt(a) - BigInt(b), true);
}

export function multiplyRatio(value: Cents, numerator: bigint, denominator: bigint): Cents {
  if (denominator <= 0n || numerator < 0n) throw new RangeError('Razão inválida');
  const product = BigInt(value) * numerator;
  const rounded = (product + denominator / 2n) / denominator;
  return checked(rounded);
}

export function formatBRL(value: Cents): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
}

export function serialize(value: Cents): number {
  return value;
}

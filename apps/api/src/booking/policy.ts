export const POLICY_VERSION = 1;
export function cancellationAmount(priceCents: number, startAt: Date, at: Date): number {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw RangeError('Preço inválido');
  return startAt.getTime() - at.getTime() >= 24 * 60 * 60 * 1000
    ? 0
    : Number((BigInt(priceCents) + 1n) / 2n);
}
export function noShowAmount(priceCents: number): number {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw RangeError('Preço inválido');
  return priceCents;
}

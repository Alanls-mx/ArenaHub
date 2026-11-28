import { permissionCodes, roleSchema, templates } from '@arenahub/contracts';
import { expect, it } from 'vitest';
import { encodePassword, matches } from './core.js';
it('deriva senhas com sal independente e compara inclusive identidade ausente', async () => {
  const a = await encodePassword('teste local'),
    b = await encodePassword('teste local');
  expect(a).not.toBe(b);
  expect(await matches('teste local', a)).toBe(true);
  expect(await matches('outra', a)).toBe(false);
  expect(await matches('teste local')).toBe(false);
});
it('limita templates ao catálogo e separa registro de recebimentos da visão global', () => {
  for (const caps of Object.values(templates))
    for (const code of caps) expect(permissionCodes).toContain(code);
  expect(templates.Staff).toEqual([
    'charges.read',
    'payments.record',
    'customers.read',
    'customers.manage',
    'sports.read',
    'venues.read',
    'hours.read',
    'pricing.simulate',
    'reservations.read',
    'reservations.create',
    'reservations.confirm',
    'reservations.reschedule',
    'reservations.cancel',
    'reservations.no_show',
    'reservations.complete',
  ]);
  expect(
    roleSchema.safeParse({ name: 'Owner', description: '', permissions: ['owner'] }).success,
  ).toBe(false);
});

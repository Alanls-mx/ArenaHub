import { z } from 'zod';
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const passwordSchema = z.string().min(12).max(128);
export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const permissionCodes = [
  'members.read',
  'members.manage',
  'roles.manage',
  'roles.assign',
  'charges.read',
  'payments.record',
  'pix.create',
  'finance.read',
  'cashflow.read',
  'revenue.read',
  'expenses.read',
  'reports.export',
  'payments.reverse',
  'refunds.request',
  'integrations.manage',
  'customers.read',
  'customers.manage',
  'customers.archive',
  'sports.read',
  'sports.manage',
  'venues.read',
  'venues.manage',
  'units.manage',
  'hours.read',
  'hours.manage',
  'pricing.read',
  'pricing.manage',
  'pricing.simulate',
  'domains.manage',
] as const;
export type Capability = (typeof permissionCodes)[number];
export const roleSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  permissions: z.array(z.enum(permissionCodes)).max(permissionCodes.length),
});
export const sessionSchema = z.object({
  name: z.string(),
  email: z.email(),
  csrf: z.string(),
  organizations: z.array(z.object({ slug: z.string(), name: z.string() })),
});
export const templates: Record<string, readonly Capability[]> = {
  Administrador: permissionCodes.filter(
    (c) => c !== 'integrations.manage' && c !== 'customers.archive' && c !== 'domains.manage',
  ),
  Gerente: [
    'members.read',
    'charges.read',
    'payments.record',
    'pix.create',
    'customers.read',
    'customers.manage',
    'sports.read',
    'venues.read',
    'hours.read',
    'pricing.read',
    'pricing.simulate',
  ],
  Staff: [
    'charges.read',
    'payments.record',
    'customers.read',
    'customers.manage',
    'sports.read',
    'venues.read',
    'hours.read',
    'pricing.simulate',
  ],
  Financeiro: [
    'charges.read',
    'payments.record',
    'pix.create',
    'finance.read',
    'cashflow.read',
    'revenue.read',
    'expenses.read',
    'reports.export',
  ],
};

export const accessSchema = z.object({
  userId: z.uuid(),
  owner: z.boolean(),
  permissions: z.array(z.enum(permissionCodes)),
});
export const roleViewSchema = roleSchema.extend({
  id: z.uuid(),
  members: z.number().int().nonnegative(),
});
export const memberViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  status: z.enum(['active', 'suspended', 'revoked']),
  is_owner: z.boolean(),
  roles: z.array(z.uuid()),
});

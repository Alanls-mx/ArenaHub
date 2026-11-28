import { z } from 'zod';

export const uuid = z.uuid();
export const civilDateSchema = z.iso.date();
export const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const pageSchema = z.object({
  q: z.string().trim().max(120).optional(),
  phone: z
    .string()
    .regex(/^\+[1-9][0-9]{6,14}$/)
    .optional(),
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  archived: z.enum(['true', 'false']).default('false'),
});
export const customerSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .regex(/^\+[1-9][0-9]{6,14}$/)
    .nullable()
    .default(null),
  email: z
    .email()
    .transform((v) => v.toLowerCase())
    .nullable()
    .default(null),
});
export const sportSchema = z.strictObject({ name: z.string().trim().min(1).max(80) });
export const venueSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  sportIds: z.array(uuid).max(30).default([]),
  unitIds: z.array(uuid).max(30).optional(),
  defaultPricePerHourCents: z.number().int().nonnegative().safe().nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .default(null),
  sortOrder: z.number().int().default(0),
});
export const unitSchema = z.strictObject({ name: z.string().trim().min(1).max(120) });
export const linksSchema = z.strictObject({ unitIds: z.array(uuid).min(1).max(30) });
export const hoursSchema = z.strictObject({
  shifts: z
    .array(
      z.strictObject({
        weekday: z.number().int().min(0).max(6),
        openTime: clockSchema,
        closeTime: clockSchema,
        spansFullDay: z.boolean().default(false),
      }),
    )
    .max(70),
});
export const exceptionSchema = z.strictObject({
  venueId: uuid.nullable().default(null),
  date: civilDateSchema,
  kind: z.enum(['CLOSED', 'SPECIAL_HOURS']),
  openTime: clockSchema.nullable().default(null),
  closeTime: clockSchema.nullable().default(null),
  description: z.string().trim().max(300).default(''),
});
export const pricingRuleSchema = z.strictObject({
  venueId: uuid,
  sportId: uuid.nullable().default(null),
  specificDate: civilDateSchema.nullable().default(null),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  startTime: clockSchema,
  endTime: clockSchema,
  pricePerHourCents: z.number().int().nonnegative().safe(),
  validFrom: civilDateSchema.nullable().default(null),
  validUntil: civilDateSchema.nullable().default(null),
});
export const quoteSchema = z.object({
  venueId: uuid,
  sportId: uuid.optional(),
  date: civilDateSchema,
  startTime: clockSchema,
  durationMinutes: z.coerce.number().int().min(1).max(1440),
});
export type PricingRuleInput = z.infer<typeof pricingRuleSchema>;

export const itemViewSchema = z.object({
  id: uuid,
  name: z.string(),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
});
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: uuid.nullable() });
export const itemPageSchema = pageOf(itemViewSchema);
export const customerViewSchema = itemViewSchema.extend({
  phone: z.string().nullable(),
  email: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});
export const customerPageSchema = pageOf(customerViewSchema);
export const venueViewSchema = itemViewSchema.extend({
  sport_ids: z.array(uuid),
  unit_ids: z.array(uuid),
  default_price_per_hour_cents: z.number().int().nullable(),
  color: z.string().nullable(),
  sort_order: z.number().int(),
  hours_count: z.number().int().nonnegative(),
});
export const venuePageSchema = pageOf(venueViewSchema);
export const hoursViewSchema = z.object({
  id: uuid,
  weekday: z.number().int(),
  open_time: clockSchema,
  close_time: clockSchema,
  spans_full_day: z.boolean(),
});
export const exceptionViewSchema = z.object({
  id: uuid,
  venue_id: uuid.nullable(),
  date: civilDateSchema,
  kind: z.enum(['CLOSED', 'SPECIAL_HOURS']),
  open_time: clockSchema.nullable(),
  close_time: clockSchema.nullable(),
  description: z.string(),
});
export const pricingRuleViewSchema = z.object({
  id: uuid,
  venue_id: uuid,
  sport_id: uuid.nullable(),
  specific_date: civilDateSchema.nullable(),
  weekday: z.number().int().nullable(),
  start_minute: z.number().int(),
  end_minute: z.number().int(),
  price_per_hour_cents: z.number().int(),
  valid_from: civilDateSchema.nullable(),
  valid_until: civilDateSchema.nullable(),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
});
export const domainViewSchema = z.object({
  id: uuid,
  hostname: z.string(),
  kind: z.enum(['platform', 'custom']),
  status: z.enum(['pending', 'verified', 'active', 'suspended']),
  created_at: z.iso.datetime({ offset: true }),
  activated_at: z.iso.datetime({ offset: true }).nullable(),
});
export const quoteViewSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(false),
    reason: z.literal('PRICE_UNAVAILABLE'),
    segments: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        ruleId: uuid.nullable(),
        pricePerHourCents: z.number().int(),
        minutes: z.number().int(),
      }),
    ),
  }),
  z.object({
    available: z.literal(true),
    totalCents: z.number().int(),
    segments: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        ruleId: uuid.nullable(),
        pricePerHourCents: z.number().int(),
        minutes: z.number().int(),
      }),
    ),
  }),
]);

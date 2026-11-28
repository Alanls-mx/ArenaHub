import { z } from 'zod';
import { civilDateSchema, clockSchema, uuid } from './operations.js';

export const reservationState = z.enum([
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
export const bookingSource = z.enum(['ADMIN', 'IN_PERSON']);
export const bookingCreateSchema = z.strictObject({
  customerId: uuid,
  venueId: uuid,
  sportId: uuid.nullable().default(null),
  date: civilDateSchema,
  startTime: clockSchema,
  durationMinutes: z.number().int().min(1).max(1440).default(60),
  initialStatus: z.enum(['PENDING', 'CONFIRMED']).default('PENDING'),
  source: bookingSource.default('ADMIN'),
  notes: z.string().trim().max(2000).default(''),
  ambiguousTimeChoice: z.enum(['earlier', 'later']).optional(),
});
export const availabilitySchema = z.object({
  venueId: uuid,
  sportId: uuid.optional(),
  date: civilDateSchema,
  startTime: clockSchema,
  durationMinutes: z.coerce.number().int().min(1).max(1440).default(60),
  ambiguousTimeChoice: z.enum(['earlier', 'later']).optional(),
});
export const agendaQuerySchema = z.object({
  from: civilDateSchema,
  to: civilDateSchema,
  venueId: uuid.optional(),
});
export const rescheduleSchema = z.strictObject({
  venueId: uuid,
  sportId: uuid.nullable().default(null),
  date: civilDateSchema,
  startTime: clockSchema,
  durationMinutes: z.number().int().min(1).max(1440),
  expectedVersion: z.number().int().positive(),
  ambiguousTimeChoice: z.enum(['earlier', 'later']).optional(),
});
export const reschedulePreviewSchema = z.object({
  venueId: uuid,
  sportId: uuid.optional(),
  date: civilDateSchema,
  startTime: clockSchema,
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  expectedVersion: z.coerce.number().int().positive(),
  ambiguousTimeChoice: z.enum(['earlier', 'later']).optional(),
});
export const transitionSchema = z.strictObject({ expectedVersion: z.number().int().positive() });
export const cancelSchema = transitionSchema.extend({
  reason: z.string().trim().min(1).max(500),
  waiveFee: z.boolean().default(false),
});
export const blockSchema = z.strictObject({
  venueId: uuid,
  date: civilDateSchema,
  startTime: clockSchema,
  durationMinutes: z.number().int().min(1).max(1440),
  reason: z.string().trim().min(1).max(500),
  ambiguousTimeChoice: z.enum(['earlier', 'later']).optional(),
});
export const recurrenceCreateSchema = z.strictObject({
  customerId: uuid,
  venueId: uuid,
  sportId: uuid.nullable().default(null),
  billingMode: z.enum(['MONTHLY', 'PER_OCCURRENCE']),
  startsOn: civilDateSchema,
  endsOn: civilDateSchema.nullable().default(null),
  priceCents: z.number().int().safe().nonnegative(),
  monthlyAmountCents: z.number().int().safe().nonnegative().nullable().default(null),
  rules: z
    .array(
      z.strictObject({
        weekday: z.number().int().min(0).max(6),
        startTime: clockSchema,
        durationMinutes: z.number().int().min(1).max(1440),
      }),
    )
    .min(1)
    .max(7),
});
export const recurrenceEstimateSchema = z.strictObject({
  startsOn: civilDateSchema,
  monthlyAmountCents: z.coerce.number().int().safe().nonnegative(),
  weekdays: z.string().regex(/^[0-6](,[0-6])*$/),
});
export const recurrenceUpdateSchema = recurrenceCreateSchema
  .omit({
    customerId: true,
    billingMode: true,
    startsOn: true,
  })
  .extend({ effectiveFrom: civilDateSchema });
export const recurrenceResolveSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('RETRY') }),
  z.strictObject({ action: z.literal('SKIP'), reason: z.string().trim().min(1).max(500) }),
  z.strictObject({
    action: z.literal('MOVE'),
    date: civilDateSchema,
    startTime: clockSchema,
    durationMinutes: z.number().int().min(1).max(1440),
    reason: z.string().trim().min(1).max(500),
  }),
]);

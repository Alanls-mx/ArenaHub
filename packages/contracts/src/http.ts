import { z } from 'zod';
import { errorCodes } from './errors.js';

export const IdempotencyKeySchema = z.uuid();

export const ProblemDetailsSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.enum(errorCodes),
  requestId: z.string().min(1),
  detail: z.string().optional(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

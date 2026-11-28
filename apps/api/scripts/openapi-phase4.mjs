import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  agendaQuerySchema,
  availabilitySchema,
  blockSchema,
  bookingCreateSchema,
  cancelSchema,
  recurrenceCreateSchema,
  recurrenceEstimateSchema,
  recurrenceResolveSchema,
  recurrenceUpdateSchema,
  rescheduleSchema,
  reschedulePreviewSchema,
  transitionSchema,
} from '@arenahub/contracts';
import prettier from 'prettier';
import { toJSONSchema, z } from 'zod';

const previous = fileURLToPath(new URL('../../../docs/OPENAPI_PHASE3.json', import.meta.url));
const target = fileURLToPath(new URL('../../../docs/OPENAPI_PHASE4.json', import.meta.url));
const document = JSON.parse(await readFile(previous, 'utf8'));
document.info = {
  title: 'ArenaHub — Fase 4',
  version: '4.0.0',
  description:
    'Contratos de agenda, reservas e recorrência; inclui os contratos operacionais da Fase 3.',
};
const schemas = {
  BookingInput: bookingCreateSchema,
  AvailabilityQuery: availabilitySchema,
  AgendaQuery: agendaQuerySchema,
  RescheduleInput: rescheduleSchema,
  ReschedulePreviewQuery: reschedulePreviewSchema,
  TransitionInput: transitionSchema,
  CancelInput: cancelSchema,
  BlockInput: blockSchema,
  RecurrenceInput: recurrenceCreateSchema,
  RecurrenceEstimateQuery: recurrenceEstimateSchema,
  RecurrenceUpdateInput: recurrenceUpdateSchema,
  ConflictResolutionInput: recurrenceResolveSchema,
  BookingResult: z.object({
    id: z.uuid(),
    status: z.string(),
    priceCents: z.number().int(),
    version: z.number().int(),
  }),
  Availability: z.object({
    available: z.boolean(),
    priceCents: z.number().int().nullable(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
  }),
  Agenda: z.object({
    reservations: z.array(z.record(z.string(), z.unknown())),
    blocks: z.array(z.record(z.string(), z.unknown())),
  }),
  Reservation: z.record(z.string(), z.unknown()),
  History: z.array(z.record(z.string(), z.unknown())),
  CancellationPreview: z.object({
    originalPriceCents: z.number().int(),
    policyPercent: z.number().int(),
    feeCents: z.number().int(),
    leadSeconds: z.number().int(),
    policyVersion: z.number().int(),
    calculatedAt: z.iso.datetime(),
    startAt: z.iso.datetime(),
    note: z.string(),
  }),
  ReschedulePreview: z.object({
    available: z.boolean(),
    oldPriceCents: z.number().int(),
    newPriceCents: z.number().int(),
    differenceCents: z.number().int(),
    oldStartAt: z.iso.datetime(),
    newStartAt: z.iso.datetime(),
    newEndAt: z.iso.datetime(),
    expectedVersion: z.number().int(),
  }),
  BlockList: z.array(z.record(z.string(), z.unknown())),
  ContractResult: z.object({
    id: z.uuid(),
    recurrenceId: z.uuid(),
    generation: z.string(),
    firstMonthAmountCents: z.number().int().nullable(),
  }),
  RecurrenceEstimate: z.object({ firstMonthAmountCents: z.number().int() }),
  ContractList: z.array(z.record(z.string(), z.unknown())),
  ContractHistory: z.array(z.record(z.string(), z.unknown())),
  ConflictList: z.array(z.record(z.string(), z.unknown())),
  ResolutionResult: z.object({ id: z.uuid(), action: z.string(), contractId: z.uuid() }),
};
const input = new Set(
  Object.keys(schemas).filter((name) => name.endsWith('Input') || name.endsWith('Query')),
);
for (const [name, value] of Object.entries(schemas)) {
  const shape = toJSONSchema(value, { io: input.has(name) ? 'input' : 'output' });
  delete shape.$schema;
  document.components.schemas[name] = shape;
}
const ref = (name) => ({ $ref: '#/components/schemas/' + name });
const slug = { name: 'slug', in: 'path', required: true, schema: { type: 'string' } };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const key = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 16, maxLength: 200 },
};
const csrf = { name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } };
const origin = { name: 'Origin', in: 'header', required: true, schema: { type: 'string' } };
const query = (name) =>
  Object.entries(document.components.schemas[name].properties ?? {}).map(([field, schema]) => ({
    name: field,
    in: 'query',
    required: (document.components.schemas[name].required ?? []).includes(field),
    schema,
  }));
const operation = (capability, response, body, parameters = [], mutation = false) => ({
  'x-capability': capability,
  parameters: [...parameters, ...(mutation ? [origin, csrf, key] : [])],
  ...(body
    ? { requestBody: { required: true, content: { 'application/json': { schema: ref(body) } } } }
    : {}),
  responses: {
    200: {
      description: 'Operação concluída',
      content: { 'application/json': { schema: ref(response) } },
    },
    default: {
      description: 'Problem Details',
      content: { 'application/problem+json': { schema: ref('Problem') } },
    },
  },
});
const path = (suffix) => `/orgs/{slug}/${suffix}`;
document.paths[path('availability')] = {
  get: operation('reservations.read', 'Availability', undefined, [
    slug,
    ...query('AvailabilityQuery'),
  ]),
};
document.paths[path('agenda')] = {
  get: operation('reservations.read', 'Agenda', undefined, [slug, ...query('AgendaQuery')]),
};
document.paths[path('reservations')] = {
  post: operation('reservations.create', 'BookingResult', 'BookingInput', [slug], true),
};
document.paths[path('reservations/{id}')] = {
  get: operation('reservations.read', 'Reservation', undefined, [slug, id]),
};
document.paths[path('reservations/{id}/history')] = {
  get: operation('reservations.read', 'History', undefined, [slug, id]),
};
for (const [action, cap] of [
  ['confirm', 'reservations.confirm'],
  ['complete', 'reservations.complete'],
  ['no_show', 'reservations.no_show'],
])
  document.paths[path(`reservations/{id}/${action}`)] = {
    post: operation(cap, 'Reservation', 'TransitionInput', [slug, id], true),
  };
document.paths[path('reservations/{id}/cancel')] = {
  post: operation('reservations.cancel', 'Reservation', 'CancelInput', [slug, id], true),
};
document.paths[path('reservations/{id}/cancellation-preview')] = {
  get: operation('reservations.cancel', 'CancellationPreview', undefined, [slug, id]),
};
document.paths[path('reservations/{id}/reschedule')] = {
  post: operation('reservations.reschedule', 'BookingResult', 'RescheduleInput', [slug, id], true),
};
document.paths[path('reservations/{id}/reschedule-preview')] = {
  get: operation('reservations.reschedule', 'ReschedulePreview', undefined, [
    slug,
    id,
    ...query('ReschedulePreviewQuery'),
  ]),
};
document.paths[path('blocks')] = {
  get: operation('schedule_blocks.manage', 'BlockList', undefined, [slug, ...query('AgendaQuery')]),
  post: operation('schedule_blocks.manage', 'Id', 'BlockInput', [slug], true),
};
document.paths[path('blocks/{id}/cancel')] = {
  post: operation('schedule_blocks.manage', 'Reservation', undefined, [slug, id], true),
};
document.paths[path('recurrence-contracts')] = {
  get: operation('recurrences.read', 'ContractList', undefined, [
    slug,
    { name: 'search', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
  ]),
  post: operation('recurrences.manage', 'ContractResult', 'RecurrenceInput', [slug], true),
};
document.paths[path('recurrence-contracts/first-month-preview')] = {
  get: operation('recurrences.manage', 'RecurrenceEstimate', undefined, [
    slug,
    ...query('RecurrenceEstimateQuery'),
  ]),
};
document.paths[path('recurrence-contracts/{id}/history')] = {
  get: operation('recurrences.read', 'ContractHistory', undefined, [slug, id]),
};
document.paths[path('recurrence-contracts/{id}/versions')] = {
  post: operation('recurrences.manage', 'Reservation', 'RecurrenceUpdateInput', [slug, id], true),
};
document.paths[path('recurrence-contracts/{id}/end')] = {
  post: operation('recurrences.manage', 'Reservation', undefined, [slug, id], true),
};
document.paths[path('recurrence-conflicts')] = {
  get: operation('recurrences.read', 'ConflictList', undefined, [slug]),
};
document.paths[path('recurrence-conflicts/{id}/resolve')] = {
  post: operation(
    'recurrences.manage',
    'ResolutionResult',
    'ConflictResolutionInput',
    [slug, id],
    true,
  ),
};
document.paths[path('agenda/stream')] = {
  get: {
    'x-websocket': {
      messages: ['agenda.connected', 'agenda.invalidate'],
      authority: 'HTTP refetch',
    },
    'x-capability': 'reservations.read',
    parameters: [slug, origin],
    responses: {
      101: { description: 'WebSocket autenticado, somente leitura' },
      default: {
        description: 'Problem Details',
        content: { 'application/problem+json': { schema: ref('Problem') } },
      },
    },
  },
};
const contents = await prettier.format(JSON.stringify(document), {
  ...(await prettier.resolveConfig(target)),
  parser: 'json',
});
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8').catch(() => null)) !== contents)
    throw Error('OpenAPI da Fase 4 desatualizada; execute pnpm openapi:generate');
  console.log('OpenAPI da Fase 4 atualizada.');
} else {
  await writeFile(target, contents);
  console.log('OpenAPI da Fase 4 gerada.');
}

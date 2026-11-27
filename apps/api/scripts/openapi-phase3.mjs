import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  customerSchema,
  sportSchema,
  venueSchema,
  unitSchema,
  linksSchema,
  hoursSchema,
  exceptionSchema,
  pricingRuleSchema,
  quoteSchema,
  pageSchema,
  customerPageSchema,
  itemPageSchema,
  venuePageSchema,
  hoursViewSchema,
  exceptionViewSchema,
  pricingRuleViewSchema,
  domainViewSchema,
  quoteViewSchema,
} from '@arenahub/contracts';
import prettier from 'prettier';
import { toJSONSchema, z } from 'zod';

const target = fileURLToPath(new URL('../../../docs/OPENAPI_PHASE3.json', import.meta.url));
const definitions = {
  CustomerInput: customerSchema,
  SportInput: sportSchema,
  VenueInput: venueSchema,
  UnitInput: unitSchema,
  LinksInput: linksSchema,
  HoursInput: hoursSchema,
  ExceptionInput: exceptionSchema,
  PricingRuleInput: pricingRuleSchema,
  QuoteQuery: quoteSchema,
  PageQuery: pageSchema,
  CustomerPage: customerPageSchema,
  ItemPage: itemPageSchema,
  VenuePage: venuePageSchema,
  HoursList: z.array(hoursViewSchema),
  ExceptionList: z.array(exceptionViewSchema),
  PricingRuleList: z.array(pricingRuleViewSchema),
  DomainList: z.array(domainViewSchema),
  Quote: quoteViewSchema,
  Id: z.object({ id: z.uuid() }),
  Ok: z.object({ ok: z.literal(true) }),
  DomainRequest: z.object({ hostname: z.string() }),
  DomainPending: z.object({
    id: z.uuid(),
    hostname: z.string(),
    status: z.literal('pending'),
    notice: z.string(),
  }),
  Problem: z.object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    requestId: z.string(),
  }),
};
const inputNames = new Set([
  'CustomerInput',
  'SportInput',
  'VenueInput',
  'UnitInput',
  'LinksInput',
  'HoursInput',
  'ExceptionInput',
  'PricingRuleInput',
  'QuoteQuery',
  'PageQuery',
  'DomainRequest',
]);
const schemas = Object.fromEntries(
  Object.entries(definitions).map(([name, value]) => {
    const shape = toJSONSchema(value, {
      io: inputNames.has(name) ? 'input' : 'output',
    });
    delete shape.$schema;
    return [name, shape];
  }),
);
const ref = (name) => ({ $ref: '#/components/schemas/' + name });
const slug = { name: 'slug', in: 'path', required: true, schema: { type: 'string' } };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const csrf = {
  name: 'X-CSRF-Token',
  in: 'header',
  required: true,
  schema: { type: 'string' },
  description: 'Token CSRF da sessão',
};
const origin = {
  name: 'Origin',
  in: 'header',
  required: true,
  schema: { type: 'string', format: 'uri' },
};
const query = (name) =>
  Object.entries(schemas[name].properties ?? {}).map(([key, value]) => ({
    name: key,
    in: 'query',
    required: (schemas[name].required ?? []).includes(key),
    schema: value,
  }));
const operation = (method, cap, response, body, parameters = []) => ({
  operationId: method + '_' + cap.replaceAll('.', '_') + '_' + (body ?? response),
  'x-capability': cap,
  parameters: [...(method === 'get' ? [] : [origin, csrf]), ...parameters],
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
const collection = (name, readCap, writeCap, view, input) => ({
  [`/orgs/{slug}/${name}`]: {
    parameters: [slug],
    get: operation('get', readCap, view, undefined, query('PageQuery')),
    post: operation('post', writeCap, 'Id', input),
  },
  [`/orgs/{slug}/${name}/{id}`]: {
    parameters: [slug, id],
    patch: operation('patch', writeCap, 'Ok', input),
    delete: operation('delete', name === 'customers' ? 'customers.archive' : writeCap, 'Ok'),
  },
});
const paths = {
  ...collection('customers', 'customers.read', 'customers.manage', 'CustomerPage', 'CustomerInput'),
  ...collection('sports', 'sports.read', 'sports.manage', 'ItemPage', 'SportInput'),
  ...collection('units', 'venues.read', 'units.manage', 'ItemPage', 'UnitInput'),
  ...collection('venues', 'venues.read', 'venues.manage', 'VenuePage', 'VenueInput'),
  '/orgs/{slug}/venues/{id}/units': {
    parameters: [slug, id],
    put: operation('put', 'units.manage', 'Ok', 'LinksInput'),
  },
  '/orgs/{slug}/venues/{id}/operating-hours': {
    parameters: [slug, id],
    get: operation('get', 'hours.read', 'HoursList'),
    put: operation('put', 'hours.manage', 'Ok', 'HoursInput'),
  },
  '/orgs/{slug}/calendar-exceptions': {
    parameters: [slug],
    get: operation('get', 'hours.read', 'ExceptionList', undefined, [
      { name: 'venueId', in: 'query', schema: { type: 'string', format: 'uuid' } },
    ]),
    post: operation('post', 'hours.manage', 'Id', 'ExceptionInput'),
  },
  '/orgs/{slug}/calendar-exceptions/{id}': {
    parameters: [slug, id],
    delete: operation('delete', 'hours.manage', 'Ok'),
  },
  '/orgs/{slug}/pricing-rules': {
    parameters: [slug],
    get: operation('get', 'pricing.read', 'PricingRuleList', undefined, [
      { name: 'venueId', in: 'query', schema: { type: 'string', format: 'uuid' } },
    ]),
    post: operation('post', 'pricing.manage', 'Id', 'PricingRuleInput'),
  },
  '/orgs/{slug}/pricing-rules/{id}': {
    parameters: [slug, id],
    patch: operation('patch', 'pricing.manage', 'Id', 'PricingRuleInput'),
    delete: operation('delete', 'pricing.manage', 'Ok'),
  },
  '/orgs/{slug}/pricing/quote': {
    parameters: [slug],
    get: operation('get', 'pricing.simulate', 'Quote', undefined, query('QuoteQuery')),
  },
  '/orgs/{slug}/domains': {
    parameters: [slug],
    get: operation('get', 'domains.manage', 'DomainList'),
  },
  '/orgs/{slug}/domains/requests': {
    parameters: [slug],
    post: operation('post', 'domains.manage', 'DomainPending', 'DomainRequest'),
  },
};
const document = {
  openapi: '3.1.1',
  info: {
    title: 'ArenaHub — Fase 3',
    version: '3.0.0',
    description:
      'Contratos operacionais. Autenticação e demais rotas da Fase 2 constam em PHASE2_ACCESS.md.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ session: [] }],
  paths,
  components: {
    securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: '__Host-session' } },
    schemas,
  },
};
const contents = await prettier.format(JSON.stringify(document), {
  ...(await prettier.resolveConfig(target)),
  parser: 'json',
});
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8').catch(() => null)) !== contents)
    throw Error('OpenAPI da Fase 3 desatualizada; execute pnpm openapi:generate');
  console.log('OpenAPI da Fase 3 atualizada.');
} else {
  await writeFile(target, contents);
  console.log('OpenAPI da Fase 3 gerada.');
}

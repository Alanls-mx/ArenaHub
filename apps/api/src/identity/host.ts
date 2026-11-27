import { domainToASCII } from 'node:url';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { deny } from './core.js';

const reserved = new Set(['api', 'app', 'auth', 'admin', 'www', 'mail', 'status', 'support']);
export function isReservedSlug(slug: string): boolean {
  return reserved.has(slug);
}

export function normalizeDomain(value: string): string {
  const raw = value.trim().replace(/\.$/, '').toLowerCase();
  const ascii = domainToASCII(raw);
  if (
    !ascii ||
    ascii.length > 253 ||
    !ascii.includes('.') ||
    ascii.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error('Hostname inválido');
  return ascii;
}

export function platformSubdomain(slug: string, baseDomain: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || reserved.has(slug))
    throw new Error('Slug reservado ou inválido');
  return normalizeDomain(`${slug}.${normalizeDomain(baseDomain)}`);
}

function requestHostname(header: string | undefined): string {
  if (!header || /[/@\\\s]/.test(header)) deny(404);
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(header);
  if (!match) deny(404);
  const port = match[2] ? Number(match[2]) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) deny(404);
  const hostname = match[1]!;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return hostname;
  try {
    return normalizeDomain(hostname);
  } catch {
    deny(404);
  }
}

export interface TrustedProxy {
  internalHost: string;
  ips: readonly string[];
}

export function hostResolver(pool: Pool, origin: string, proxy?: TrustedProxy) {
  const platform = new URL(origin);
  const platformHost = requestHostname(platform.host);
  const bound = new WeakMap<FastifyRequest, string>();
  return {
    async resolve(request: FastifyRequest): Promise<void> {
      const forwarded = request.headers['x-forwarded-host'];
      const fromProxy =
        proxy && request.headers.host === proxy.internalHost && proxy.ips.includes(request.ip);
      const publicHost =
        fromProxy && typeof forwarded === 'string' ? forwarded : request.headers.host;
      const host = requestHostname(publicHost);
      if (host === platformHost) {
        if (publicHost !== platform.host && !['localhost', '127.0.0.1'].includes(host)) deny(404);
        return;
      }
      const row = (
        await pool.query<{ organization_id: string }>(
          `SELECT d.organization_id FROM arena_identity.organization_domains d
         JOIN arena_identity.organizations o ON o.id=d.organization_id
         WHERE d.hostname=$1 AND d.status='active' AND o.active`,
          [host],
        )
      ).rows[0];
      if (!row) deny(404);
      bound.set(request, row.organization_id);
    },
    organization(request: FastifyRequest): string | undefined {
      return bound.get(request);
    },
  };
}

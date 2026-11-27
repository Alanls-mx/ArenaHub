import { describe, expect, it } from 'vitest';
import { normalizeDomain, platformSubdomain } from './host.js';

describe('hostnames de organização', () => {
  it('normaliza caixa e IDN e rejeita portas, caminhos e nomes reservados', () => {
    expect(normalizeDomain('Arena.Example.COM.')).toBe('arena.example.com');
    expect(normalizeDomain('café.example')).toBe('xn--caf-dma.example');
    for (const value of ['arena.example:443', 'https://arena.example', 'a..example', 'a/example']) {
      expect(() => normalizeDomain(value)).toThrow();
    }
    expect(platformSubdomain('arena-sul', 'example.com')).toBe('arena-sul.example.com');
    expect(() => platformSubdomain('api', 'example.com')).toThrow();
  });
});

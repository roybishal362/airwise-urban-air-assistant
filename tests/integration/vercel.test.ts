import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { composeApp } from '../../src/server.js';
import { createVercelApp } from '../../src/vercel.js';

/**
 * On Vercel, public/ is served by the CDN without passing through Express, so
 * vercel.json must give those files the same security headers helmet adds.
 * These tests stop the two from drifting apart.
 */

interface VercelConfig {
  framework: null;
  regions: string[];
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;
const quiet = { LOG_LEVEL: 'silent', LLM_PROVIDER: 'none' };

const SECURITY_HEADERS = [
  'content-security-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'origin-agent-cluster',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-dns-prefetch-control',
  'x-download-options',
  'x-frame-options',
  'x-permitted-cross-domain-policies',
  'x-xss-protection',
  'permissions-policy',
];

describe('Vercel deployment config', () => {
  it('gives CDN-served static files exactly the headers the app sends', async () => {
    const { app } = composeApp(quiet);
    const page = await request(app).get('/');
    expect(page.status).toBe(200);
    const rule = vercel.headers.find((h) => h.source === '/:path((?!api/).*)');
    const configured = Object.fromEntries(
      (rule?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]),
    );
    for (const name of SECURITY_HEADERS) {
      expect(configured[name], name).toBe(page.headers[name]);
    }
    expect(Object.keys(configured).sort()).toEqual([...SECURITY_HEADERS].sort());
  });

  it('routes every API path to the single function and runs it in Mumbai', () => {
    expect(vercel.framework).toBeNull();
    expect(vercel.rewrites).toEqual([{ source: '/api/(.*)', destination: '/api' }]);
    expect(vercel.regions).toEqual(['bom1']);
  });

  it('uploads only an allow-list, so .env and personal files never leave the machine', () => {
    const rules = readFileSync('.vercelignore', 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(rules[0]).toBe('/*');
    const allowed = rules.filter((r) => r.startsWith('!')).map((r) => r.slice(1));
    expect(allowed).toEqual(
      expect.arrayContaining(['api', 'src', 'public', 'package.json', 'vercel.json']),
    );
    expect(allowed.some((path) => path.includes('.env') || path.includes('voicebox'))).toBe(false);
  });
});

describe('serverless entry', () => {
  it('serves the API and trusts exactly one proxy hop', async () => {
    const app = createVercelApp(quiet);
    expect(app.get('trust proxy')).toBe(1);
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('pins trust to one hop even if a copied .env says otherwise', () => {
    // Importing a local .env (TRUST_PROXY_HOPS=0) must not merge all visitors
    // into one rate-limit bucket, and 2+ would allow IP spoofing.
    for (const hops of ['0', '2']) {
      expect(createVercelApp({ ...quiet, TRUST_PROXY_HOPS: hops }).get('trust proxy')).toBe(1);
    }
  });

  it('re-exports the compiled entry from the function file', () => {
    const fn = readFileSync('api/index.js', 'utf8');
    expect(fn).toContain("from '../dist/vercel.js'");
    expect(fn).toContain('export default createVercelApp()');
  });
});

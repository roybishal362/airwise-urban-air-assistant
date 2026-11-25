import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb, rewriteHtml, type WebBuildResult } from '../../scripts/build-web.js';
import { cacheControlFor, PUBLIC_DIR, WEB_BUILD_DIR } from '../../src/app.js';
import { composeApp, selectStaticDir } from '../../src/server.js';

/**
 * The production UI build: one hashed, minified JS and CSS file, cached for a
 * year, with the HTML rewritten to use them. Built into a temp folder.
 */
let out: string;
let built: WebBuildResult;

beforeAll(async () => {
  out = await mkdtemp(path.join(tmpdir(), 'airwise-web-'));
  built = await buildWeb({ outDir: out });
}, 60_000);
afterAll(() => rm(out, { recursive: true, force: true }));

const read = (publicPath: string) => readFile(path.join(out, publicPath), 'utf8');

describe('production web build', () => {
  it('bundles 26 modules into one hashed JS file and one hashed CSS file', async () => {
    expect(built.script).toMatch(/^\/assets\/app-[A-Z0-9]{8}\.js$/);
    expect(built.stylesheet).toMatch(/^\/assets\/styles-[A-Z0-9]{8}\.css$/);
    expect((await readdir(path.join(out, 'assets'))).sort()).toEqual(
      [path.basename(built.script), path.basename(built.stylesheet)].sort(),
    );
    const js = await read(built.script);
    // Fully bundled: no imports of other files are left to fetch.
    expect(js).not.toMatch(/\bfrom\s*["']\.{0,2}\//);
    expect(js).not.toMatch(/\bimport\s*\(\s*["']/);
    expect(js.split('\n').length).toBeLessThan(5); // minified
  });

  it('rewrites the HTML to the bundle, with no preloads of the dev modules', async () => {
    const html = await read('index.html');
    expect(html).toContain(`<script type="module" src="${built.script}"></script>`);
    expect(html).toContain(`<link rel="stylesheet" href="${built.stylesheet}" />`);
    expect(html).not.toMatch(/modulepreload|\/js\/|\/css\//);
    expect(html).not.toMatch(/<script>|<style>|\son[a-z]+=/); // still CSP-clean: no inline code
  });

  it('is smaller than the sources and copies the other static files', async () => {
    const total = Object.values(built.sizes).reduce((sum, s) => sum + s.gzip, 0);
    expect(total).toBeLessThan(32 * 1024);
    for (const file of ['favicon.svg', 'manifest.webmanifest']) {
      expect(await read(file)).toBe(await readFile(path.join('public', file), 'utf8'));
    }
  });

  it('refuses to guess when the HTML changes shape', () => {
    expect(() => rewriteHtml('<html></html>', '/a.js', '/a.css')).toThrow(/expected script/);
  });
});

describe('serving the build', () => {
  it('caches hashed assets for a year and revalidates everything else', () => {
    expect(cacheControlFor(path.join('dist', 'web', 'assets', 'app-ABCD1234.js'))).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlFor('/srv/dist/web/assets/styles-ABCD1234.css')).toContain('immutable');
    expect(cacheControlFor(path.join('public', 'js', 'app.js'))).toBe('no-cache');
    expect(cacheControlFor('index.html')).toBe('no-cache');
    expect(cacheControlFor('favicon.svg')).toBe('public, max-age=86400');
  });

  it('serves the build in production only, so development edits show immediately', () => {
    expect(selectStaticDir('production', true)).toBe(WEB_BUILD_DIR);
    expect(selectStaticDir('production', false)).toBe(PUBLIC_DIR);
    expect(selectStaticDir('development', true)).toBe(PUBLIC_DIR);
  });

  it('sends the immutable header from Express in production', async () => {
    await buildWeb(); // into dist/web, as `npm run build` does
    const { app } = composeApp({
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      LLM_PROVIDER: 'none',
    });
    const page = await request(app).get('/');
    const script = /src="(\/assets\/app-[A-Z0-9]{8}\.js)"/.exec(page.text)?.[1] ?? '';
    const asset = await request(app).get(script);
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(page.headers['cache-control']).toBe('no-cache');
  }, 60_000);
});

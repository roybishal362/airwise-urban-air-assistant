import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Production build of the browser app. Development serves the readable,
 * unbundled ES modules in public/; production gets:
 *
 *  - one minified JS bundle instead of 26 modules (26 requests → 1),
 *  - minified CSS,
 *  - content-hashed file names under /assets/, so they can be cached for a
 *    year ("immutable") and a deploy can never mix old and new files,
 *  - index.html rewritten to use them (it stays revalidated on every visit).
 *
 * No framework and no inline code: the strict CSP is unchanged.
 */

export interface WebBuildResult {
  outDir: string;
  /** Public paths, e.g. /assets/app-3F2A1B.js */
  script: string;
  stylesheet: string;
  /** Output file → { raw, gzip } bytes. */
  sizes: Record<string, { raw: number; gzip: number }>;
}

export const ASSETS_DIR = 'assets';

const SCRIPT_TAG = /<script type="module" src="\/js\/main\.js"><\/script>/;
const STYLE_TAG = /<link rel="stylesheet" href="\/css\/styles\.css" \/>/;
const MODULE_PRELOADS = /\n[ \t]*<link rel="modulepreload" href="\/js\/[^"]+" \/>/g;

/** Rewrite the development HTML to the hashed production assets. */
export function rewriteHtml(html: string, script: string, stylesheet: string): string {
  if (!SCRIPT_TAG.test(html) || !STYLE_TAG.test(html)) {
    throw new Error('index.html no longer has the expected script/stylesheet tags');
  }
  return html
    .replace(MODULE_PRELOADS, '')
    .replace(SCRIPT_TAG, `<script type="module" src="${script}"></script>`)
    .replace(STYLE_TAG, `<link rel="stylesheet" href="${stylesheet}" />`);
}

/** Bundle and minify JS and CSS into hashed files; returns their paths on disk. */
async function bundle(srcDir: string, assetsDir: string): Promise<{ js: string; css: string }> {
  const result = await build({
    entryPoints: {
      app: path.join(srcDir, 'js', 'main.js'),
      styles: path.join(srcDir, 'css', 'styles.css'),
    },
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2022'],
    outdir: assetsDir,
    entryNames: '[name]-[hash]',
    legalComments: 'none',
    metafile: true,
    logLevel: 'silent',
  });
  const outputs = Object.keys(result.metafile.outputs);
  const js = outputs.find((file) => file.endsWith('.js'));
  const css = outputs.find((file) => file.endsWith('.css'));
  if (!js || !css) throw new Error('esbuild produced no JS or CSS bundle');
  return { js, css };
}

/** Everything else in public/ (favicon, manifest) is copied as is. */
async function copyStatic(srcDir: string, outDir: string): Promise<void> {
  const bundled = new Set(['js', 'css', 'index.html']);
  for (const entry of await readdir(srcDir)) {
    if (!bundled.has(entry))
      await cp(path.join(srcDir, entry), path.join(outDir, entry), { recursive: true });
  }
}

/** Raw and gzip size of each file, keyed by file name. */
async function measure(files: readonly string[]): Promise<WebBuildResult['sizes']> {
  const sizes: WebBuildResult['sizes'] = {};
  for (const file of files) {
    const bytes = await readFile(file);
    sizes[path.basename(file)] = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  }
  return sizes;
}

export async function buildWeb({
  srcDir = 'public',
  outDir = path.join('dist', 'web'),
}: { srcDir?: string; outDir?: string } = {}): Promise<WebBuildResult> {
  const assetsDir = path.join(outDir, ASSETS_DIR);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  const { js, css } = await bundle(srcDir, assetsDir);
  const publicPath = (file: string) => `/${ASSETS_DIR}/${path.basename(file)}`;
  const script = publicPath(js);
  const stylesheet = publicPath(css);
  await copyStatic(srcDir, outDir);
  const html = await readFile(path.join(srcDir, 'index.html'), 'utf8');
  const htmlOut = path.join(outDir, 'index.html');
  await writeFile(htmlOut, rewriteHtml(html, script, stylesheet));
  return { outDir, script, stylesheet, sizes: await measure([htmlOut, js, css]) };
}

/* v8 ignore start -- command-line entry; buildWeb itself is tested */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { outDir, sizes } = await buildWeb();
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  for (const [file, size] of Object.entries(sizes)) {
    const where = file === 'index.html' ? file : `${ASSETS_DIR}/${file}`;
    console.log(`${outDir}/${where}: ${kb(size.raw)} (${kb(size.gzip)} gzip)`);
  }
}
/* v8 ignore stop */

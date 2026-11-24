import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Production build of the browser app. Development serves the readable,
 * unbundled ES modules in public/; production gets:
 *
 *  - one minified JS bundle instead of 24 modules (24 requests → 1),
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
const MODULE_PRELOADS = /\s*<link rel="modulepreload" href="\/js\/[^"]+" \/>/g;

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

export async function buildWeb({
  srcDir = 'public',
  outDir = path.join('dist', 'web'),
}: { srcDir?: string; outDir?: string } = {}): Promise<WebBuildResult> {
  const assetsDir = path.join(outDir, ASSETS_DIR);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

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
  const publicPath = (file: string) => `/${ASSETS_DIR}/${path.basename(file)}`;
  const js = outputs.find((file) => file.endsWith('.js'));
  const css = outputs.find((file) => file.endsWith('.css'));
  if (!js || !css) throw new Error('esbuild produced no JS or CSS bundle');
  const script = publicPath(js);
  const stylesheet = publicPath(css);

  // Everything else in public/ (favicon, manifest) is copied as is.
  for (const entry of await readdir(srcDir)) {
    if (entry === 'js' || entry === 'css' || entry === 'index.html') continue;
    await cp(path.join(srcDir, entry), path.join(outDir, entry), { recursive: true });
  }
  const html = await readFile(path.join(srcDir, 'index.html'), 'utf8');
  await writeFile(path.join(outDir, 'index.html'), rewriteHtml(html, script, stylesheet));

  const sizes: WebBuildResult['sizes'] = {};
  for (const file of ['index.html', js, css]) {
    const full = file === 'index.html' ? path.join(outDir, file) : file;
    const bytes = await readFile(full);
    sizes[path.basename(file)] = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  }
  return { outDir, script, stylesheet, sizes };
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

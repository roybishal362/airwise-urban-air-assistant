import { readFileSync } from 'node:fs';
import path from 'node:path';

/** In-memory Web Storage with an optional "quota exceeded" mode. */
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
}

export const INDEX_HTML = readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf8');

/** Load the real page markup into the jsdom document (scripts are not executed). */
export function loadPage(): void {
  const parsed = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
  document.documentElement.lang = parsed.documentElement.lang;
  document.head.replaceChildren(
    ...Array.from(parsed.head.childNodes, (n) => document.importNode(n, true)),
  );
  document.body.replaceChildren(
    ...Array.from(parsed.body.childNodes, (n) => document.importNode(n, true)),
  );
}

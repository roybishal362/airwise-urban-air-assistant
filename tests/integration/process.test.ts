import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * End-to-end smoke test of the real process entry point: spawn
 * `src/server.ts` exactly as `npm run dev` does, wait for its structured
 * "listening" log line, call the API over real HTTP, then stop it.
 */
describe('server process', () => {
  it('starts from the entry point, serves the API and logs structured JSON', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '0',
        LOG_LEVEL: 'info',
        LLM_PROVIDER: 'none',
        GEMINI_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start in time')), 20_000);
        let buffer = '';
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          for (const line of buffer.split('\n')) {
            if (!line.includes('AirWise listening')) continue;
            clearTimeout(timer);
            const entry = JSON.parse(line) as { severity: string; port: number; assistant: string };
            expect(entry.severity).toBe('INFO');
            expect(entry.assistant).toBe('rules');
            resolve(entry.port);
          }
        });
        child.once('exit', (code) => reject(new Error(`server exited early with code ${code}`)));
      });
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(await page.text()).toContain('<title>AirWise');
    } finally {
      child.kill();
    }
  }, 30_000);
});

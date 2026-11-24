import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { isEntryPoint, startServer } from '../../src/server.js';
import { createAssistant } from '../../src/services/assistant/assistantService.js';
import { createBriefService } from '../../src/services/briefService.js';
import type { OpenMeteoClient } from '../../src/services/openMeteo.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const logger = createLogger('silent');
const fakeClient: OpenMeteoClient = {
  getAirQuality: async () => makeAir(),
  getWeather: async () => makeWeather(),
  searchPlaces: async () => [DELHI],
};
const app = createApp({
  briefService: createBriefService({ client: fakeClient, logger }),
  assistant: createAssistant(null, logger),
  logger,
  trustProxyHops: 0,
  rateLimitPerMinute: 100,
  chatRateLimitPerMinute: 100,
});
const body = { location: DELHI, standard: 'auto', household: makeHousehold() };

describe('cross-site request guard', () => {
  it('refuses POSTs from other websites (Origin or Sec-Fetch-Site)', async () => {
    const byOrigin = await request(app)
      .post('/api/brief')
      .set('Origin', 'https://evil.example')
      .send(body);
    expect(byOrigin.status).toBe(403);
    expect(byOrigin.body.error.code).toBe('CROSS_SITE_REQUEST');
    const byFetchSite = await request(app)
      .post('/api/chat')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ ...body, message: 'hi' });
    expect(byFetchSite.status).toBe(403);
    const malformed = await request(app).post('/api/brief').set('Origin', 'null').send(body);
    expect(malformed.status).toBe(403);
  });

  it('allows same-origin browser requests, direct navigation and non-browser clients', async () => {
    const sameOrigin = await request(app)
      .post('/api/brief')
      .set('Host', 'airwise.test')
      .set('Origin', 'https://airwise.test')
      .set('Sec-Fetch-Site', 'same-origin')
      .send(body);
    expect(sameOrigin.status).toBe(200);
    expect(
      (await request(app).post('/api/brief').set('Sec-Fetch-Site', 'none').send(body)).status,
    ).toBe(200);
    expect((await request(app).post('/api/brief').send(body)).status).toBe(200);
    expect((await request(app).get('/api/health').set('Sec-Fetch-Site', 'cross-site')).status).toBe(
      200,
    );
  });

  it('rejects non-JSON request bodies with 415', async () => {
    const res = await request(app)
      .post('/api/brief')
      .set('Content-Type', 'text/plain')
      .send('location=Delhi');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('request IDs', () => {
  it('tags every response with a unique UUID for log correlation', async () => {
    const a = await request(app).get('/api/health');
    const b = await request(app).get('/');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(a.headers['x-request-id']).toMatch(uuid);
    expect(b.headers['x-request-id']).toMatch(uuid);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});

describe('production server bootstrap', () => {
  it('boots the real wiring on a free port and shuts down cleanly', async () => {
    const running = await startServer(
      { PORT: '0', LOG_LEVEL: 'silent', LLM_PROVIDER: 'none' },
      { client: fakeClient },
    );
    try {
      expect(running.port).toBeGreaterThan(0);
      const health = await fetch(`http://127.0.0.1:${running.port}/api/health`);
      expect(await health.json()).toEqual({ status: 'ok', assistant: 'rules' });
      const brief = await fetch(`http://127.0.0.1:${running.port}/api/brief`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(brief.status).toBe(200);
    } finally {
      await running.close();
    }
    expect(running.server.listening).toBe(false);
  });

  it('rejects invalid configuration before listening', async () => {
    await expect(startServer({ PORT: 'not-a-port' })).rejects.toThrow(/PORT/);
  });

  it('reports a port that is already taken', async () => {
    const first = await startServer(
      { PORT: '0', LOG_LEVEL: 'silent', LLM_PROVIDER: 'none' },
      { client: fakeClient },
    );
    try {
      await expect(
        startServer(
          { PORT: String(first.port), LOG_LEVEL: 'silent', LLM_PROVIDER: 'none' },
          { client: fakeClient },
        ),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });

  it('only auto-starts when run as the entry point', () => {
    expect(isEntryPoint('file:///app/dist/server.js', undefined)).toBe(false);
    expect(isEntryPoint(import.meta.url, '/somewhere/else.js')).toBe(false);
  });
});

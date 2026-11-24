import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createAssistant } from './services/assistant/assistantService.js';
import { selectProvider } from './services/assistant/llm.js';
import { createBriefService } from './services/briefService.js';
import { createOpenMeteoClient, type OpenMeteoClient } from './services/openMeteo.js';
import { createOpenAqClient, type StationClient } from './services/openaq.js';

export interface RunningServer {
  server: Server;
  port: number;
  logger: Logger;
  close(): Promise<void>;
}

/**
 * Compose the real dependencies and start listening. Exported (instead of
 * running on import) so tests can boot the production wiring on a free port.
 */
export async function startServer(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { client?: OpenMeteoClient; stations?: StationClient | null } = {},
): Promise<RunningServer> {
  const config = loadConfig(env);
  const logger = createLogger(config.logLevel);
  const briefService = createBriefService({
    client: overrides.client ?? createOpenMeteoClient({ timeoutMs: config.upstreamTimeoutMs }),
    stations:
      overrides.stations !== undefined
        ? overrides.stations
        : config.openAqApiKey
          ? createOpenAqClient({ apiKey: config.openAqApiKey, timeoutMs: config.upstreamTimeoutMs })
          : null,
    logger,
  });
  const assistant = createAssistant(selectProvider(config.llm), logger);
  const app = createApp({
    briefService,
    assistant,
    logger,
    trustProxyHops: config.trustProxyHops,
    rateLimitPerMinute: config.rateLimitPerMinute,
    chatRateLimitPerMinute: config.chatRateLimitPerMinute,
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port);
    server.once('error', reject);
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      logger.info('AirWise listening', {
        port,
        assistant: assistant.mode,
        stations: config.openAqApiKey ? 'openaq' : 'model-only',
        env: config.env,
      });
      resolve({
        server,
        port,
        logger,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((error) => (error ? fail(error) : done())),
          ),
      });
    });
  });
}

/** True when this file is the process entry point (`node dist/server.js`, `tsx src/server.ts`). */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(argv1).href;
}

/* v8 ignore start -- process entry point; exercised by the spawn test in tests/integration/process.test.ts */
if (isEntryPoint(import.meta.url, process.argv[1])) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const running = await startServer();
  const shutdown = (signal: string): void => {
    running.logger.info('shutting down', { signal });
    void running.close().then(() => process.exit(0));
    // Cloud Run allows 10 s after SIGTERM; never hang past that.
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
/* v8 ignore stop */

import type { Express } from 'express';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp, PUBLIC_DIR, WEB_BUILD_DIR } from './app.js';
import { loadConfig, type AppConfig } from './config.js';
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

export interface ComposedApp {
  app: Express;
  config: AppConfig;
  logger: Logger;
  assistantMode: string;
}

export interface Overrides {
  client?: OpenMeteoClient;
  stations?: StationClient | null;
}

/**
 * Production serves the bundled, hashed build when it exists; development
 * always serves the readable sources so edits show up without a rebuild.
 */
export function selectStaticDir(env: string, buildExists: boolean): string {
  return env === 'production' && buildExists ? WEB_BUILD_DIR : PUBLIC_DIR;
}

/** Measured station data needs a (free) OpenAQ key; without one the app runs on the model alone. */
export function stationClient(config: AppConfig): StationClient | null {
  if (!config.openAqApiKey) return null;
  return createOpenAqClient({ apiKey: config.openAqApiKey, timeoutMs: config.upstreamTimeoutMs });
}

/** Stop accepting connections; resolves once in-flight requests finish. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Build the production app from environment variables. Shared by the
 * long-running server below and the serverless entry (`src/vercel.ts`), so
 * both run exactly the same wiring. Throws on invalid configuration.
 */
export function composeApp(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Overrides = {},
): ComposedApp {
  const config = loadConfig(env);
  const logger = createLogger(config.logLevel);
  const briefService = createBriefService({
    client: overrides.client ?? createOpenMeteoClient({ timeoutMs: config.upstreamTimeoutMs }),
    stations: overrides.stations !== undefined ? overrides.stations : stationClient(config),
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
    staticDir: selectStaticDir(config.env, existsSync(path.join(WEB_BUILD_DIR, 'index.html'))),
  });
  return { app, config, logger, assistantMode: assistant.mode };
}

/**
 * Compose the real dependencies and start listening. Exported (instead of
 * running on import) so tests can boot the production wiring on a free port.
 */
export async function startServer(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Overrides = {},
): Promise<RunningServer> {
  const { app, config, logger, assistantMode } = composeApp(env, overrides);

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port);
    server.once('error', reject);
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      logger.info('AirWise listening', {
        port,
        assistant: assistantMode,
        stations: config.openAqApiKey ? 'openaq' : 'model-only',
        env: config.env,
      });
      resolve({
        server,
        port,
        logger,
        close: () => closeServer(server),
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
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}
/* v8 ignore stop */

import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createAssistant } from './services/assistant/assistantService.js';
import { selectProvider } from './services/assistant/llm.js';
import { createBriefService } from './services/briefService.js';
import { createOpenMeteoClient } from './services/openMeteo.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const logger = createLogger(config.logLevel);

const briefService = createBriefService({
  client: createOpenMeteoClient({ timeoutMs: config.upstreamTimeoutMs }),
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

const server = app.listen(config.port, () => {
  logger.info('AirWise listening', {
    port: config.port,
    assistant: assistant.mode,
    env: config.env,
  });
});

const shutdown = (signal: string): void => {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));
  // Cloud Run allows 10 s after SIGTERM; never hang past that.
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

import { z } from 'zod';
import type { LogLevel } from './lib/logger.js';

/** Empty strings in .env files mean "not set". */
const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // 0 asks the OS for any free port (used by tests).
  PORT: z.coerce.number().int().min(0).max(65_535).default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(6000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(60),
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  LLM_PROVIDER: z.enum(['auto', 'gemini', 'claude', 'none']).default('auto'),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-3.5-flash-lite,gemini-3.8-flash'),
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(12_000),
});

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  logLevel: LogLevel;
  trustProxyHops: number;
  upstreamTimeoutMs: number;
  rateLimitPerMinute: number;
  chatRateLimitPerMinute: number;
  llm: {
    provider: 'auto' | 'gemini' | 'claude' | 'none';
    geminiApiKey?: string | undefined;
    geminiModel: string;
    anthropicApiKey?: string | undefined;
    anthropicModel: string;
    timeoutMs: number;
  };
}

/** Validate the environment once at start-up and fail fast on bad values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid configuration for: ${fields}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    upstreamTimeoutMs: e.UPSTREAM_TIMEOUT_MS,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    chatRateLimitPerMinute: e.CHAT_RATE_LIMIT_PER_MINUTE,
    llm: {
      provider: e.LLM_PROVIDER,
      geminiApiKey: e.GEMINI_API_KEY,
      geminiModel: e.GEMINI_MODEL,
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      anthropicModel: e.ANTHROPIC_MODEL,
      timeoutMs: e.LLM_TIMEOUT_MS,
    },
  };
}

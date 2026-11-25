import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from '../../config.js';
import type { ChatTurn } from './prompt.js';

/**
 * Provider-neutral GenAI interface. The assistant depends on this, not on a
 * vendor SDK, so providers are swappable and tests inject fakes.
 */
export interface LlmProvider {
  readonly name: 'gemini' | 'claude';
  generate(system: string, turns: readonly ChatTurn[]): Promise<string>;
}

/** The model could not answer (error, timeout, refusal or empty reply); callers fall back to rule-based answers. */
export class LlmUnavailableError extends Error {
  override readonly name = 'LlmUnavailableError';
}

/** Hard cap on what we pass back to the browser, whatever the model returns. */
export const MAX_REPLY_CHARS = 3000;

/** Trim and cap a model reply; an empty reply counts as unavailable. */
const finalise = (text: string | undefined | null): string => {
  const trimmed = (text ?? '').trim();
  if (!trimmed) throw new LlmUnavailableError('Empty model response');
  return trimmed.slice(0, MAX_REPLY_CHARS);
};

// ---------------------------------------------------------------- Gemini ---

export interface GeminiModelsApi {
  generateContent(params: {
    model: string;
    contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
    config: { systemInstruction: string; maxOutputTokens: number; abortSignal?: AbortSignal };
  }): Promise<{ text?: string }>;
}

/** HTTP statuses that mean "this model can't serve right now, try the next one". */
const NEXT_MODEL_STATUSES: ReadonlySet<number> = new Set([404, 408, 429, 500, 502, 503, 504]);

/**
 * Model availability changes over time (models are retired, or overloaded at
 * peak). Retired/overloaded/timed-out models fall through to the next model in
 * the chain; auth or request errors (400/401/403) stop immediately.
 */
export function shouldTryNextModel(error: unknown): boolean {
  if (error instanceof LlmUnavailableError) return true;
  if (typeof error !== 'object' || error === null) return false;
  if ('name' in error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return true;
  return (
    'status' in error && typeof error.status === 'number' && NEXT_MODEL_STATUSES.has(error.status)
  );
}

/** `"a, b"` → `["a", "b"]` (the GEMINI_MODEL setting is an ordered fallback chain). */
export function parseModelChain(value: string): string[] {
  return value
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

/** Gemini provider that tries each model in order, each call bounded by the timeout. */
export function createGeminiProvider(options: {
  apiKey: string;
  /** Ordered fallback chain, fastest/cheapest first. */
  models: readonly string[];
  timeoutMs: number;
  client?: GeminiModelsApi;
}): LlmProvider {
  if (options.models.length === 0) throw new Error('At least one Gemini model is required');
  const client: GeminiModelsApi =
    options.client ?? new GoogleGenAI({ apiKey: options.apiKey }).models;
  return {
    name: 'gemini',
    async generate(system, turns) {
      const contents = turns.map((t) => ({
        role: t.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: t.content }],
      }));
      let lastError: unknown = new LlmUnavailableError('No Gemini model available');
      for (const model of options.models) {
        try {
          const response = await client.generateContent({
            model,
            contents,
            config: {
              systemInstruction: system,
              maxOutputTokens: 2048,
              // Hard per-model deadline, independent of SDK-level retries.
              abortSignal: AbortSignal.timeout(options.timeoutMs),
            },
          });
          return finalise(response.text);
        } catch (error) {
          if (!shouldTryNextModel(error)) throw error;
          lastError = error;
        }
      }
      throw lastError;
    },
  };
}

// ---------------------------------------------------------------- Claude ---

type ClaudeParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ClaudeMessage = Anthropic.Beta.Messages.BetaMessage;

export interface ClaudeMessagesApi {
  create(params: ClaudeParams): Promise<ClaudeMessage>;
}

/** Claude provider bounded by the timeout; a refusal counts as unavailable. */
export function createClaudeProvider(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  messages?: ClaudeMessagesApi;
}): LlmProvider {
  let messages = options.messages;
  if (!messages) {
    const client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: 1,
    });
    messages = { create: (params) => client.beta.messages.create(params) };
  }
  const api = messages;
  return {
    name: 'claude',
    async generate(system, turns) {
      const response = await api.create({
        model: options.model,
        // Short chat answers; adaptive thinking at low effort keeps latency down.
        max_tokens: 4096,
        output_config: { effort: 'low' },
        // If a safety classifier declines, the API re-routes to a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      });
      if (response.stop_reason === 'refusal')
        throw new LlmUnavailableError('Model declined the request');
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n');
      return finalise(text);
    },
  };
}

/** The assistant's slice of the app configuration (single definition in config.ts). */
export type LlmConfig = AppConfig['llm'];

/** Pick a provider from configuration; `null` means rule-based answers only. */
export function selectProvider(config: LlmConfig): LlmProvider | null {
  const gemini = (): LlmProvider | null =>
    config.geminiApiKey
      ? createGeminiProvider({
          apiKey: config.geminiApiKey,
          models: parseModelChain(config.geminiModel),
          timeoutMs: config.timeoutMs,
        })
      : null;
  const claude = (): LlmProvider | null =>
    config.anthropicApiKey
      ? createClaudeProvider({
          apiKey: config.anthropicApiKey,
          model: config.anthropicModel,
          timeoutMs: config.timeoutMs,
        })
      : null;

  switch (config.provider) {
    case 'none':
      return null;
    case 'gemini':
      return gemini();
    case 'claude':
      return claude();
    case 'auto':
      return gemini() ?? claude();
  }
}

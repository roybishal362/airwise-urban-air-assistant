import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { ChatTurn } from './prompt.js';

/**
 * Provider-neutral GenAI interface. The assistant depends on this, not on a
 * vendor SDK, so providers are swappable and tests inject fakes.
 */
export interface LlmProvider {
  readonly name: 'gemini' | 'claude';
  generate(system: string, turns: readonly ChatTurn[]): Promise<string>;
}

export class LlmUnavailableError extends Error {
  override readonly name = 'LlmUnavailableError';
}

/** Hard cap on what we pass back to the browser, whatever the model returns. */
export const MAX_REPLY_CHARS = 3000;

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
    config: { systemInstruction: string; maxOutputTokens: number };
  }): Promise<{ text?: string | undefined }>;
}

export function createGeminiProvider(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  models?: GeminiModelsApi;
}): LlmProvider {
  const models: GeminiModelsApi =
    options.models ??
    new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { timeout: options.timeoutMs } }).models;
  return {
    name: 'gemini',
    async generate(system, turns) {
      const response = await models.generateContent({
        model: options.model,
        contents: turns.map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: t.content }],
        })),
        config: { systemInstruction: system, maxOutputTokens: 2048 },
      });
      return finalise(response.text);
    },
  };
}

// ---------------------------------------------------------------- Claude ---

type ClaudeParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ClaudeMessage = Anthropic.Beta.Messages.BetaMessage;

export interface ClaudeMessagesApi {
  create(params: ClaudeParams): Promise<ClaudeMessage>;
}

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

export interface LlmConfig {
  provider: 'auto' | 'gemini' | 'claude' | 'none';
  geminiApiKey?: string | undefined;
  geminiModel: string;
  anthropicApiKey?: string | undefined;
  anthropicModel: string;
  timeoutMs: number;
}

/** Pick a provider from configuration; `null` means rule-based answers only. */
export function selectProvider(config: LlmConfig): LlmProvider | null {
  const gemini = (): LlmProvider | null =>
    config.geminiApiKey
      ? createGeminiProvider({
          apiKey: config.geminiApiKey,
          model: config.geminiModel,
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

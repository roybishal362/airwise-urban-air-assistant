import type { AirBrief } from '../../domain/brief.js';
import type { Household } from '../../domain/household.js';
import type { Logger } from '../../lib/logger.js';
import { FOLLOW_UPS, detectIntent, type Intent } from './intent.js';
import type { LlmProvider } from './llm.js';
import { SYSTEM_PROMPT, buildConversation, type ChatTurn } from './prompt.js';
import { composeRuleAnswer } from './ruleResponder.js';

export interface AssistantRequest {
  message: string;
  history: readonly ChatTurn[];
  brief: AirBrief;
  household: Household;
}

export interface AssistantReply {
  reply: string;
  /** Which engine produced the text: a GenAI provider or the offline rules. */
  source: LlmProvider['name'] | 'rules';
  intent: Intent;
  suggestions: readonly string[];
}

export interface Assistant {
  readonly mode: LlmProvider['name'] | 'rules';
  reply(request: AssistantRequest): Promise<AssistantReply>;
}

/**
 * GenAI first, deterministic rules as the safety net. Any provider failure
 * (timeout, quota, refusal, empty output) falls back to the rule-based answer,
 * so the family always gets a correct, grounded response.
 */
export function createAssistant(provider: LlmProvider | null, logger: Logger): Assistant {
  return {
    mode: provider?.name ?? 'rules',
    async reply({ message, history, brief, household }) {
      const intent = detectIntent(message);
      const suggestions = FOLLOW_UPS[intent];

      if (provider) {
        try {
          const turns = buildConversation(message, history, brief, household);
          const reply = await provider.generate(SYSTEM_PROMPT, turns);
          return { reply, source: provider.name, intent, suggestions };
        } catch (error) {
          // Log the failure class only: never the user's message or profile.
          logger.warn('genai provider failed, using rule-based answer', {
            provider: provider.name,
            error: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
      return { reply: composeRuleAnswer(intent, brief), source: 'rules', intent, suggestions };
    },
  };
}

import { KEYWORDS } from './intentKeywords.js';

/**
 * Lightweight, deterministic intent detection. It powers the offline
 * rule-based assistant and the follow-up suggestions, and works for English
 * plus common Hinglish words (e.g. "bacche", "khidki", "dhuan").
 */
export const INTENTS = [
  'greeting',
  'health',
  'mask',
  'indoor',
  'commute',
  'community',
  'emissions',
  'best_time',
  'outdoor',
  'smog',
  'status',
] as const;
export type Intent = (typeof INTENTS)[number];

/** One keyword as a regex fragment: the text is literal; a trailing `*` matches any word ending. */
function keywordSource(keyword: string): string {
  const wildcard = keyword.endsWith('*');
  const stem = wildcard ? keyword.slice(0, -1) : keyword;
  const literal = stem.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return wildcard ? `${literal}\\w*` : literal;
}

/** A whole-word, case-insensitive matcher for a keyword list. */
const matcher = (keywords: readonly string[]): RegExp =>
  new RegExp(`\\b(?:${keywords.map(keywordSource).join('|')})\\b`, 'i');

const RULES: readonly (readonly [Intent, RegExp])[] = KEYWORDS.map(
  ([intent, keywords]) => [intent, matcher(keywords)] as const,
);

const GREETING = /^\s*(hi|hello|hey|namaste|namaskar|help|start|what can you do)\b[\s!.?]*$/i;

/** The intent of a message: a greeting, else the first matching keyword rule, else "status". */
export function detectIntent(message: string): Intent {
  if (GREETING.test(message)) return 'greeting';
  for (const [intent, pattern] of RULES) {
    if (pattern.test(message)) return intent;
  }
  return 'status';
}

export const FOLLOW_UPS: Readonly<Record<Intent, readonly string[]>> = {
  greeting: [
    'Is it safe for my kids to play outside today?',
    'What is the best time to go for a walk?',
    'How can my family cut emissions this week?',
  ],
  health: ['Which mask should we use?', 'How do I make the bedroom air cleaner?'],
  mask: ['Can I exercise outside today?', 'Should I keep the windows closed?'],
  indoor: [
    'When should I open the windows?',
    'Is my purifier big enough?',
    'Do indoor plants help?',
  ],
  commute: [
    'How much CO₂ would I save by taking the metro?',
    'Which mask should I wear on the commute?',
  ],
  community: [
    'What can our residents association do this winter?',
    'How much would 50 homes composting save?',
  ],
  emissions: [
    'How much CO₂ would I save by taking the metro?',
    'What can our residents association do this winter?',
  ],
  best_time: ['Is it safe for my kids to play outside today?', 'When should I open the windows?'],
  outdoor: ['When is the cleanest hour today?', 'Which mask should we use?'],
  smog: ['Why is the air worst at night?', 'Will it get better this evening?'],
  status: [
    'Is it safe for my kids to play outside today?',
    'How can my family cut emissions this week?',
  ],
};

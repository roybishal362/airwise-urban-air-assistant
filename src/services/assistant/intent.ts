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

/** Checked in order: safety-related intents first, the generic status last. */
const RULES: readonly (readonly [Intent, RegExp])[] = [
  [
    'health',
    /\b(cough\w*|wheez\w*|asthma|breath\w*|chest|symptom\w*|headache|throat|eyes? (?:burn|itch|water)\w*|pregnan\w*|copd|heart|inhaler|doctor|hospital|sick|dizzy|khansi|saans)\b/i,
  ],
  ['mask', /\b(masks?|n95|kn95|ffp2|respirator)\b/i],
  [
    'indoor',
    /\b(indoors?|inside|home|house|rooms?|windows?|khidki|purifiers?|ventilat\w*|filters?|plants?|cook\w*|kitchen|incense|agarbatti|heater|angithi|ac)\b/i,
  ],
  [
    'commute',
    /\b(commut\w*|office|metro|bus|car|bike|scooter|drive|driving|auto|carpool\w*|travel\w*)\b/i,
  ],
  ['community', /\b(community|neighbou?rs?|society|rwa|colony|street|together|campaign)\b/i],
  [
    'emissions',
    /\b(emissions?|carbon|co2|footprint|sustainab\w*|eco|green|climate|reduce pollution|my impact|difference)\b/i,
  ],
  ['best_time', /\b(when|what time|best time|which hour|schedule|timing)\b/i],
  [
    'outdoor',
    /\b(run\w*|jog\w*|walk\w*|exercis\w*|workout|play\w*|park|outside|outdoors?|cycl\w*|yoga|sports?|cricket|football|bacch\w*|kids?|children)\b/i,
  ],
  [
    'smog',
    /\b(smog|fog|inversion|why|tomorrow|tonight|forecast|later|wind|stubble|parali|dhuan)\b/i,
  ],
];

const GREETING = /^\s*(hi|hello|hey|namaste|namaskar|help|start|what can you do)\b[\s!.?]*$/i;

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

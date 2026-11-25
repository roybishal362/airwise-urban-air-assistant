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

/**
 * Keywords per intent, checked in order: safety-related intents first, the
 * generic status last. A trailing `*` matches any word ending
 * ("cough*" → cough, coughing); multi-word phrases match as written.
 */
const KEYWORDS: readonly (readonly [Intent, readonly string[]])[] = [
  [
    'health',
    [
      'cough*',
      'wheez*',
      'asthma',
      'breath*',
      'chest',
      'symptom*',
      'headache',
      'throat',
      'eye burn*',
      'eyes burn*',
      'eye itch*',
      'eyes itch*',
      'eye water*',
      'eyes water*',
      'pregnan*',
      'copd',
      'heart',
      'inhaler',
      'doctor',
      'hospital',
      'sick',
      'dizzy',
      'khansi',
      'saans',
    ],
  ],
  ['mask', ['mask', 'masks', 'n95', 'kn95', 'ffp2', 'respirator']],
  [
    'indoor',
    [
      'indoor',
      'indoors',
      'inside',
      'home',
      'house',
      'room',
      'rooms',
      'window',
      'windows',
      'khidki',
      'purifier',
      'purifiers',
      'ventilat*',
      'filter',
      'filters',
      'plant',
      'plants',
      'cook*',
      'kitchen',
      'incense',
      'agarbatti',
      'heater',
      'angithi',
      'ac',
    ],
  ],
  [
    'commute',
    [
      'commut*',
      'office',
      'metro',
      'bus',
      'car',
      'bike',
      'scooter',
      'drive',
      'driving',
      'auto',
      'carpool*',
      'travel*',
    ],
  ],
  [
    'community',
    [
      'community',
      'neighbor',
      'neighbors',
      'neighbour',
      'neighbours',
      'society',
      'rwa',
      'colony',
      'street',
      'together',
      'campaign',
    ],
  ],
  [
    'emissions',
    [
      'emission',
      'emissions',
      'carbon',
      'co2',
      'footprint',
      'sustainab*',
      'eco',
      'green',
      'climate',
      'reduce pollution',
      'my impact',
      'difference',
    ],
  ],
  ['best_time', ['when', 'what time', 'best time', 'which hour', 'schedule', 'timing']],
  [
    'outdoor',
    [
      'run*',
      'jog*',
      'walk*',
      'exercis*',
      'workout',
      'play*',
      'park',
      'outside',
      'outdoor',
      'outdoors',
      'cycl*',
      'yoga',
      'sport',
      'sports',
      'cricket',
      'football',
      'bacch*',
      'kid',
      'kids',
      'children',
    ],
  ],
  [
    'smog',
    [
      'smog',
      'fog',
      'inversion',
      'why',
      'tomorrow',
      'tonight',
      'forecast',
      'later',
      'wind',
      'stubble',
      'parali',
      'dhuan',
    ],
  ],
];

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

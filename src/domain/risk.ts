import { CONDITION_LABELS, assessVulnerability, formatList, type Household } from './household.js';
import { POLLUTANT_LABELS } from './aqi/standards.js';
import type { AqiReading, SeverityLevel } from './types.js';
import type { SmogOutlook } from './smog.js';

export type Verdict = 'normal' | 'take_care' | 'limit_outdoor' | 'stay_indoors';

export interface MemberAdvice {
  who: string;
  advice: string;
}

export interface FamilyRisk {
  /** Personal risk level for the most vulnerable member (0–5). */
  level: SeverityLevel;
  verdict: Verdict;
  headline: string;
  reasons: string[];
  memberAdvice: MemberAdvice[];
}

/**
 * The headline names who the verdict is for: when the level was raised only
 * because of a sensitive member, healthy adults get a milder message.
 */
function headlineFor(verdict: Verdict, airLevel: SeverityLevel, groups: readonly string[]): string {
  const who = formatList(groups);
  switch (verdict) {
    case 'normal':
      return 'Normal day: enjoy time outdoors.';
    case 'take_care':
      return 'Take care: shorten outdoor time for sensitive family members.';
    case 'limit_outdoor':
      return airLevel >= 3
        ? 'Right now, limit outdoor time for everyone; move exercise and play indoors.'
        : `Right now, limit outdoor time for ${who}; healthy adults can go out but take it easy.`;
    case 'stay_indoors':
      return airLevel >= 4
        ? 'Stay indoors as much as possible and keep indoor air clean.'
        : `Keep ${who} indoors as much as possible; everyone else should limit outdoor time.`;
  }
}

export function verdictFor(level: SeverityLevel): Verdict {
  if (level <= 1) return 'normal';
  if (level === 2) return 'take_care';
  if (level === 3) return 'limit_outdoor';
  return 'stay_indoors';
}

const clampLevel = (n: number): SeverityLevel => Math.max(0, Math.min(5, n)) as SeverityLevel;

const CONDITION_ADVICE: Readonly<Record<Household['conditions'][number], string>> = {
  asthma:
    'Carry the reliever inhaler, follow the asthma action plan and stop at the first wheeze or chest tightness.',
  copd: 'Keep rescue medication close, avoid exertion outdoors and watch for increased breathlessness or sputum.',
  heart_disease:
    'Avoid outdoor exertion; seek care for chest pain, palpitations or unusual fatigue (fine particles raise heart-attack risk).',
  diabetes:
    'Diabetes raises cardiovascular sensitivity to PM2.5: keep outdoor activity light and stay hydrated.',
  pregnancy:
    'Minimise time in traffic and smoke: PM2.5 exposure in pregnancy is linked to low birth weight and preterm birth.',
  allergies:
    'Pollution can worsen allergy symptoms: keep windows closed during peaks and rinse eyes and nose after being outside.',
};

function adviceForAdults(airLevel: SeverityLevel): string {
  if (airLevel <= 1) return 'No restrictions. Ideal day for a walk or cycling.';
  if (airLevel === 2)
    return 'Fine for most adults; take it easier if you notice coughing or irritation.';
  if (airLevel === 3)
    return 'Reduce long or intense outdoor exercise; wear an N95 for longer outdoor trips.';
  return 'Avoid outdoor exercise; wear a well-fitted N95 whenever outside.';
}

function adviceForChildren(airLevel: SeverityLevel): string {
  if (airLevel <= 1) return 'Outdoor play is fine.';
  if (airLevel === 2) return 'Keep outdoor play short and gentle, during the cleanest hours.';
  if (airLevel === 3)
    return 'Move play indoors; children breathe faster and inhale more pollution per kg of body weight.';
  return 'Keep children indoors; if they must go out, use a child-size N95 and keep trips short.';
}

function adviceForSeniors(airLevel: SeverityLevel): string {
  if (airLevel <= 1) return 'A morning walk is fine.';
  if (airLevel === 2) return 'Prefer indoor walking; watch for breathlessness or chest discomfort.';
  return 'Stay indoors in the cleanest room; keep medicines and emergency contacts at hand.';
}

/**
 * Explainable family risk: start from the air's severity level, then add one
 * level when anyone at home is in a sensitive group (EPA and CPCB both single
 * these groups out first). The most vulnerable member sets the family verdict.
 */
export function assessFamilyRisk(
  reading: AqiReading,
  household: Household,
  smog?: SmogOutlook,
): FamilyRisk {
  const airLevel = reading.category.level;
  const vulnerability = assessVulnerability(household);
  const sensitivityBump = vulnerability.isSensitive && airLevel >= 1 ? 1 : 0;
  const level = clampLevel(airLevel + sensitivityBump);
  const verdict = verdictFor(level);

  const reasons = [
    `Air is "${reading.category.label}" (${reading.value} on the ${reading.standard === 'in' ? 'India NAQI' : 'US AQI'} scale), severity ${airLevel} of 5.`,
    `${POLLUTANT_LABELS[reading.dominantPollutant]} is the main pollutant right now.`,
  ];
  if (sensitivityBump) {
    reasons.push(
      `Your household includes ${formatList(vulnerability.groups)}, who react to pollution sooner, so we raise the family's risk by one level.`,
    );
  }
  if (smog && (smog.trapRisk === 'high' || smog.trapRisk === 'severe')) {
    reasons.push(
      `Smog-trap risk is ${smog.trapRisk}: calm air will hold pollution near the ground for hours.`,
    );
  }

  const memberAdvice: MemberAdvice[] = [];
  const { adults, children, seniors } = household.members;
  if (adults > 0) memberAdvice.push({ who: 'Adults', advice: adviceForAdults(airLevel) });
  if (children > 0) memberAdvice.push({ who: 'Children', advice: adviceForChildren(airLevel) });
  if (seniors > 0) memberAdvice.push({ who: 'Older adults', advice: adviceForSeniors(airLevel) });
  if (airLevel >= 1) {
    for (const condition of household.conditions) {
      const label = CONDITION_LABELS[condition];
      memberAdvice.push({
        who: `Family member with ${label}`,
        advice: CONDITION_ADVICE[condition],
      });
    }
  }

  return {
    level,
    verdict,
    headline: headlineFor(verdict, airLevel, vulnerability.groups),
    reasons,
    memberAdvice,
  };
}

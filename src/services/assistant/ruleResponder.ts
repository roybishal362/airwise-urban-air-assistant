import type { AirBrief } from '../../domain/brief.js';
import { signedPercent, windowLabel } from '../../domain/time.js';
import type { TimeWindow } from '../../domain/types.js';
import type { Intent } from './intent.js';

/**
 * Deterministic answers composed only from the AirBrief. Used when no GenAI
 * key is configured or the model is unavailable, so the assistant always
 * works and never states a number the engines did not compute.
 */

const bullet = (text: string): string => `- ${text}`;

/** How clean a window is, in words (level 1 = good). */
function windowQuality(level: number): string {
  if (level <= 1) return 'clean';
  return level === 2 ? 'fair' : 'still polluted';
}

/** The most polluted stretch to avoid, or a note that none is forecast. */
function peakText(worst: AirBrief['forecast']['windows']['worst'], now: string): string {
  if (!worst) return 'no major peak forecast';
  return `${windowLabel(worst.start, worst.end, now)} (peak AQI ~${worst.peakAqi})`;
}

const describeWindow = (w: TimeWindow | null, fallback: string, now: string): string =>
  w
    ? `${windowLabel(w.start, w.end, now)} (AQI ~${w.averageAqi}, ${windowQuality(w.level)})`
    : fallback;

function statusAnswer(b: AirBrief): string[] {
  return [
    b.summary,
    bullet(b.risk.reasons[0] ?? ''),
    bullet(
      `Top tip: ${b.routine[0]?.title ?? b.indoor.hacks[0]?.title ?? 'keep indoor air clean'}.`,
    ),
    bullet(`Source: ${b.dataSource.label}`),
  ];
}

function outdoorAnswer(b: AirBrief): string[] {
  const lines = [b.risk.headline];
  for (const m of b.risk.memberAdvice.slice(0, 4)) lines.push(bullet(`${m.who}: ${m.advice}`));
  lines.push(
    bullet(
      `Cleanest hour for exercise: ${describeWindow(b.forecast.windows.outdoor, 'no clean hour today', b.observedAt)}.`,
    ),
  );
  const play = b.routine.find((step) => step.id === 'play');
  if (play) lines.push(bullet(`Children (${play.when}): ${play.title}. ${play.why}`));
  return lines;
}

function bestTimeAnswer(b: AirBrief): string[] {
  const w = b.forecast.windows;
  return [
    "Today's windows, based on the hourly forecast:",
    bullet(`Exercise or errands: ${describeWindow(w.outdoor, 'none clean enough', b.observedAt)}.`),
    bullet(
      `Air out the home: ${describeWindow(w.ventilation, 'keep windows shut today', b.observedAt)}.`,
    ),
    bullet(`Children's play: ${describeWindow(w.play, 'indoor play today', b.observedAt)}.`),
    bullet(`Avoid: ${peakText(w.worst, b.observedAt)}.`),
  ];
}

function indoorAnswer(b: AirBrief): string[] {
  const lines = [
    `With windows shut, indoor PM2.5 is likely ~${b.indoor.baselineIndoorPm25} µg/m³ while outdoors is ~${b.indoor.outdoorPm25}.`,
  ];
  for (const hack of b.indoor.hacks.slice(0, 4))
    lines.push(bullet(`${hack.title}: ${hack.impact}`));
  return lines;
}

function commuteAnswer(b: AirBrief): string[] {
  if (!b.commute)
    return [
      'You told me you do not commute, so your biggest wins are at home:',
      ...indoorAnswer(b).slice(1),
    ];
  const { current, alternatives } = b.commute;
  const lines = [
    `Your ${current.label.toLowerCase()} commute: ~${current.co2KgPerWeek} kg CO₂ a week, and ~${current.inhaledPm25UgPerDay} µg of PM2.5 inhaled each day.`,
  ];
  for (const alt of alternatives.slice(0, 3)) {
    lines.push(
      bullet(
        `${alt.label}: saves ${alt.co2SavedKgPerYear} kg CO₂ a year; inhaled PM2.5 ${signedPercent(alt.inhaledChangePct)}. ${alt.note}`,
      ),
    );
  }
  if (alternatives.length === 0)
    lines.push(
      bullet(
        'You already use one of the lowest-emission options. Keep wearing an N95 on bad days.',
      ),
    );
  return lines;
}

function emissionsAnswer(b: AirBrief): string[] {
  const lines = ['Your highest-impact changes, with their yearly effect:'];
  for (const action of b.actions.slice(0, 4))
    lines.push(bullet(`${action.title}: ${action.impactStatement}`));
  return lines;
}

function communityAnswer(b: AirBrief): string[] {
  const n = b.communityHouseholds;
  const c = b.community;
  const lines = [
    n > 1
      ? `If all ${n} households adopt this plan: ~${c.total.co2KgPerYear.toLocaleString('en-US')} kg CO₂ and ~${c.total.pm25GPerYear.toLocaleString('en-US')} g PM2.5 avoided a year (what ~${c.treesEquivalent.toLocaleString('en-US')} trees absorb). Biggest contributors:`
      : 'Set the community size in your profile to see the combined impact. Per household:',
  ];
  for (const action of b.actions.slice(0, 3)) {
    const q = action.community;
    const parts = [
      q.co2KgPerYear !== null ? `${q.co2KgPerYear.toLocaleString('en-US')} kg CO₂` : null,
      q.pm25GPerYear !== null ? `${q.pm25GPerYear.toLocaleString('en-US')} g PM2.5` : null,
    ].filter(Boolean);
    lines.push(
      bullet(`${action.title}: ${parts.join(' and ') || 'cleaner air at street level'} a year.`),
    );
  }
  lines.push(
    bullet(
      'Ideas: a society compost pit, a no-burning pledge, carpool groups, and purifiers in shared spaces for children and elders.',
    ),
  );
  return lines;
}

function maskAnswer(b: AirBrief): string[] {
  const particulate =
    b.current.dominantPollutant === 'pm2_5' || b.current.dominantPollutant === 'pm10';
  return [
    'Use a well-fitted N95, KN95 or FFP2 respirator (child sizes exist). Cloth and surgical masks do not block fine particles.',
    bullet(
      'Fit matters more than brand: pinch the nose clip and make sure there are no gaps at the cheeks.',
    ),
    bullet(
      particulate
        ? `Today's main pollutant is ${b.current.dominantLabel}, which N95s filter well.`
        : `Today's main pollutant is ${b.current.dominantLabel}, a gas that N95s do not filter, so limit time outdoors instead.`,
    ),
    bullet('Masks make hard exercise uncomfortable; move workouts indoors on bad days instead.'),
  ];
}

function healthAnswer(b: AirBrief): string[] {
  const lines = [
    `Seek emergency care right away (call ${b.region.emergencyNumber}) for chest pain, severe breathlessness, bluish lips or confusion.`,
    `Air today: ${b.current.category.label} (${b.standard.shortName} ${b.current.aqi}). ${b.risk.headline}`,
  ];
  for (const m of b.risk.memberAdvice
    .filter((a) => a.who.startsWith('Family member'))
    .slice(0, 3)) {
    lines.push(bullet(`${m.who}: ${m.advice}`));
  }
  lines.push(bullet('I am not a doctor. For persistent symptoms please consult one.'));
  return lines;
}

function smogAnswer(b: AirBrief): string[] {
  const lines = b.smog.explanation.slice(0, 3);
  if (b.forecast.trend) {
    lines.push(
      bullet(
        `Next ${b.forecast.trend.lookaheadHours} h: AQI ${b.forecast.trend.now} → ~${b.forecast.trend.next} (${b.forecast.trend.direction}).`,
      ),
    );
  }
  if (b.policy) {
    lines.push(bullet(`${b.policy.name}: ${b.policy.stageLabel}. ${b.policy.forYou[0] ?? ''}`));
  }
  return lines;
}

function greetingAnswer(b: AirBrief): string[] {
  return [
    `Namaste! I'm AirWise. ${b.summary}`,
    'Ask me when it is safe to go out, how to keep indoor air clean, or which everyday changes cut pollution the most, and I will show the impact in numbers.',
  ];
}

const HANDLERS: Readonly<Record<Intent, (b: AirBrief) => string[]>> = {
  greeting: greetingAnswer,
  health: healthAnswer,
  mask: maskAnswer,
  indoor: indoorAnswer,
  commute: commuteAnswer,
  community: communityAnswer,
  emissions: emissionsAnswer,
  best_time: bestTimeAnswer,
  outdoor: outdoorAnswer,
  smog: smogAnswer,
  status: statusAnswer,
};

export function composeRuleAnswer(intent: Intent, brief: AirBrief): string {
  return HANDLERS[intent](brief)
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

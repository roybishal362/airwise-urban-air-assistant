import type { Household } from './household.js';
import {
  cookingHack,
  everydayHacks,
  heatingHack,
  purifierHacks,
  ventilationHack,
} from './indoorHacks.js';
import {
  MODEL,
  estimateIndoorPm25,
  recommendedCadr,
  roomVolume,
  type IndoorHack,
  type IndoorInput,
  type IndoorOption,
  type IndoorPlan,
  type Room,
} from './indoorModel.js';

export {
  MODEL,
  estimateIndoorPm25,
  recommendedCadr,
  roomVolume,
  type IndoorHack,
  type IndoorInput,
  type IndoorOption,
  type IndoorPlan,
} from './indoorModel.js';

/** One filtration option with its indoor PM2.5 and reduction versus no filter. */
function option(id: IndoorOption['id'], label: string, cadr: number, room: Room): IndoorOption {
  const indoor = estimateIndoorPm25(room.outdoor, cadr, room.volume);
  return {
    id,
    label,
    cadrM3h: cadr,
    airChangesPerHour: Math.round((cadr / room.volume) * 10) / 10,
    indoorPm25: indoor,
    reductionPct:
      room.baseline > 0 ? Math.round(((room.baseline - indoor) / room.baseline) * 100) : 0,
  };
}

/** The family's own purifier (or a DIY fan filter if they have none), then one sized for the room. */
function filterOptions(home: Household['home'], room: Room, recommended: number): IndoorOption[] {
  const first =
    home.hasAirPurifier && home.purifierCadrM3h > 0
      ? option('current_purifier', 'Your purifier', home.purifierCadrM3h, room)
      : option('diy_fan_filter', 'DIY fan + filter', MODEL.diyFanFilterCadrM3h, room);
  return [first, option('recommended_purifier', 'Purifier rated for this room', recommended, room)];
}

/** Build indoor estimates and a prioritised list of practical "hacks". */
export function buildIndoorPlan(input: IndoorInput): IndoorPlan {
  const { household, outdoorPm25, airLevel } = input;
  const volume = roomVolume(household.home.roomAreaSqm);
  const room: Room = {
    volume,
    outdoor: outdoorPm25,
    baseline: estimateIndoorPm25(outdoorPm25, 0, volume),
  };
  const recommended = recommendedCadr(household.home.roomAreaSqm);
  const partial = {
    roomVolumeM3: Math.round(volume),
    outdoorPm25: Math.round(outdoorPm25),
    baselineIndoorPm25: room.baseline,
    recommendedCadrM3h: recommended,
    options: filterOptions(household.home, room, recommended),
  };
  const heating = heatingHack(household);
  const hacks: IndoorHack[] = [
    ...purifierHacks(input, partial),
    ventilationHack(input),
    cookingHack(household),
    ...(heating ? [heating] : []),
    ...everydayHacks(airLevel, room),
  ];
  hacks.sort((a, b) => a.priority - b.priority);
  return { ...partial, hacks };
}

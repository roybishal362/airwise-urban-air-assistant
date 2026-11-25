# Problem statement alignment

**Challenge 6, Urban Air Quality Assistant:** _create a GenAI-powered assistant that helps families and communities
navigate severe winter smog and urban air pollution through low-emission daily routines, indoor air-quality hacks and
sustainable alternatives tailored to their location and lifestyle, while clearly explaining the direct impact of each
recommendation._

Every clause maps to working code on the live app (https://airwise-urban-air-assistant.vercel.app) and to the tests
that hold it in place.

| Requirement                           | What AirWise does                                                                                                                                                                                              | Code                                                                                       | Tests                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **GenAI-powered assistant**           | Chat on Google **Gemini** (Claude optional), grounded in a per-household "air brief" built by deterministic engines; answers in English or Hindi; a rule-based assistant answers if the model is unavailable   | `src/services/assistant/`                                                                  | `assistant.test.ts`, `edge-cases.test.ts`, `dom.test.ts`   |
| **Families**                          | Household profile (adults, children, older adults, health conditions); risk follows the most vulnerable member; advice per member                                                                              | `src/domain/household.ts`, `src/domain/risk.ts`                                            | `household-risk.test.ts`, `properties.test.ts`             |
| **Communities**                       | "Households acting together" multiplies every action into a community headline (t CO₂ and kg PM2.5 avoided a year, overlapping transport options counted once); pledges; one-tap sharing                       | `src/domain/impact/actions.ts`, `public/js/community.js`, `public/js/controllers/share.js` | `indoor-impact.test.ts`, `dom.test.ts`, `features.test.ts` |
| **Severe winter smog**                | Smog-trap analysis from mixing height × wind (ventilation coefficient), fog detection, worst-period warning; India's CPCB NAQI chosen automatically in India; **Delhi-NCR GRAP stage** and what it means here  | `src/domain/smog.ts`, `src/domain/policy.ts`, `src/domain/aqi/`                            | `smog.test.ts`, `region-policy.test.ts`, `aqi.test.ts`     |
| **Urban air pollution, measured**     | "Right now" comes from the nearest official monitoring stations (OpenAQ; CPCB/DPCC in Delhi), named on screen with the measurement time; the CAMS forecast is calibrated to them                               | `src/services/openaq.ts`, `src/domain/calibration.ts`                                      | `stations.test.ts`                                         |
| **Low-emission daily routines**       | A time-stamped plan from the hourly forecast: cleanest hour to exercise, when to air the home, children's play slot, commute choice, cooking, close-up before the peak, bedtime filtration                     | `src/domain/routine.ts`, `src/domain/forecast.ts`                                          | `brief-routine.test.ts`, `forecast.test.ts`                |
| **Indoor air-quality hacks**          | Purifier and DIY fan-filter sizing with a mass-balance model (indoor PM2.5 before → after), ventilation timing, gap sealing, clean cooking and heating, myth-busters                                           | `src/domain/indoor.ts`                                                                     | `indoor-impact.test.ts`, `properties.test.ts`              |
| **Sustainable alternatives**          | Commute comparison (metro, bus, carpool, EV, cycling, walking) with inhaled-dose safety, home-working days, no-idling, composting instead of burning, clean cooking fuel, electric heating, saving electricity | `src/domain/impact/`                                                                       | `indoor-impact.test.ts`, `region-policy.test.ts`           |
| **Tailored to location**              | Any searched city or the browser's location (with a city-level fallback); local AQI standard and time zone; country grid carbon intensity; local emergency number; India-only schemes shown only in India      | `src/domain/region.ts`, `src/http/approxLocation.ts`, `public/js/controllers/search.js`    | `region-policy.test.ts`, `locate.test.ts`, `app.test.ts`   |
| **Tailored to lifestyle**             | Commute mode and distance, home-working, cooking fuel, winter heating, outdoor exercise, room size, purifier CADR and health conditions change every recommendation                                            | `src/domain/household.ts`, `public/js/profileForm.js`                                      | `household-risk.test.ts`, `features.test.ts`               |
| **Clearly explain the direct impact** | Every recommendation carries an "Impact:" line with numbers from cited factors: inhaled µg of PM2.5, indoor PM2.5 before → after, kg CO₂, g PM2.5 and NOx a year, tree-equivalents, community totals           | `src/domain/impact/factors.ts`, `src/domain/indoor.ts`                                     | `indoor-impact.test.ts`, `brief-routine.test.ts`           |

## Why the numbers can be trusted

- **The model explains, the code computes.** Gemini receives the computed brief and is told to use only those
  numbers; it never estimates a figure itself ([`src/services/assistant/prompt.ts`](src/services/assistant/prompt.ts)).
- **Sources are visible.** The data source (official stations or the labelled model estimate) is shown on screen, and
  the assistant names it whenever it quotes current levels; impact factors cite their sources
  ([`src/domain/impact/factors.ts`](src/domain/impact/factors.ts)) and the README lists every data source.
- **Verified on real data:** captured Delhi data is a test fixture, and the live app was checked against Delhi's
  official monitors (see the red-team log in [`docs/DECISIONS.md`](docs/DECISIONS.md)).

More detail: [README, section 1](README.md#1-the-problem-and-how-airwise-answers-it) and the
[demo video](https://youtu.be/1Vuj0Vgyci4).

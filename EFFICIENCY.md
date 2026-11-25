# Efficiency

AirWise is built to load fast on a mid-range phone on a mobile network, and to stay inside free API quotas no matter
how many families use it.

## Front end: three files, cached for a year

- **No framework.** The UI is 28 small ES modules in development. `npm run build`
  ([`scripts/build-web.ts`](scripts/build-web.ts), esbuild) turns them into **one minified JS bundle and one minified
  CSS file with content-hashed names**, and rewrites the HTML to use them.
- **Size** (`npm run build` prints it): HTML 7.6 KB, JS 13.8 KB, CSS 5.9 KB gzipped, **27.3 KB in total**. A test
  fails the build above 32 KB ([`tests/unit/build-web.test.ts`](tests/unit/build-web.test.ts)).
- **Caching:** hashed `/assets/` files are served `immutable` for a year (a deploy changes their names), only the HTML
  is revalidated, icons and the manifest are cached for a day ([`vercel.json`](vercel.json), mirrored by Express and
  checked by [`tests/integration/vercel.test.ts`](tests/integration/vercel.test.ts)).
- **Measured on the live site** (Chrome, India → Mumbai region): 8 requests on a first visit (6 files + 2 API calls,
  down from 31 before the build step); on a repeat visit only the 300-byte HTML check goes to the network.
- **Lighthouse on the live site** (25 Nov 2026, Lighthouse 12): **100 / 100 / 100 / 100** (Performance,
  Accessibility, Best Practices, SEO) on both mobile and desktop. Mobile: first and largest contentful paint
  1.3 s, total blocking time 0 ms, layout shift 0. Reproduce with
  `npx lighthouse https://airwise-urban-air-assistant.vercel.app/`.
- **No layout work in JavaScript:** charts are small inline SVGs and the gauge needle rotates with a CSS custom
  property; nothing is drawn on a canvas or polled on a timer.

## Back end: few, small, shared upstream calls

| Technique                      | Effect                                                                                                                                          | Code                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| TTL + LRU cache                | Air 10 min, station readings 10 min, weather 30 min, geocoding 24 h, at most 500 entries                                                        | [`src/services/cache.ts`](src/services/cache.ts)                       |
| Shared cache keys              | Coordinates rounded to ~1 km, so neighbours share one upstream call                                                                             | [`src/services/briefService.ts`](src/services/briefService.ts)         |
| In-flight coalescing           | Simultaneous requests for the same area share one upstream fetch (tested in `tests/unit/infrastructure.test.ts`)                                | `src/services/cache.ts`                                                |
| Parallel, bounded fetches      | Air, weather and stations load in parallel; hard timeouts; one retry only for transient errors (network, 429, 5xx)                              | [`src/lib/http.ts`](src/lib/http.ts)                                   |
| Quota-friendly station look-up | At most 4 small requests (1 search + up to 3 readings in parallel) per ~1 km area per 10 minutes, far inside OpenAQ's free 60 requests a minute | [`src/services/openaq.ts`](src/services/openaq.ts)                     |
| Compact GenAI prompt           | A projection of the brief (~9 KB, roughly 2–3 k tokens) with capped output; the rule-based assistant answers instantly without a model call     | [`src/services/assistant/prompt.ts`](src/services/assistant/prompt.ts) |
| Close to users                 | Static files from Vercel's CDN; the API runs in Mumbai (`bom1`)                                                                                 | [`vercel.json`](vercel.json)                                           |

## Algorithms

All planning work is small and bounded: the window search scans at most 48 hourly points for windows of a few hours,
station selection sorts at most 100 candidates by distance, and there is no database.

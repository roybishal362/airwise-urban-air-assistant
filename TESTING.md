# Testing

**409 automated tests in 25 files, all passing**, run on every push to `main` on Node 20 and 22
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). No test touches the network: upstream APIs and GenAI
providers are replaced by injected fakes, and real captured Delhi data is used as a fixture.

```bash
npm test                # all 409 tests (Vitest)
npm run test:coverage   # the same, with v8 coverage and enforced thresholds
```

## Coverage

| Metric     | Measured               | CI threshold |
| ---------- | ---------------------- | ------------ |
| Lines      | **100 %** (1921/1921)  | 97 %         |
| Statements | **99.3 %** (2185/2200) | 97 %         |
| Functions  | **99.8 %** (596/597)   | 97 %         |
| Branches   | **95.1 %** (1313/1381) | 90 %         |

## What the suites cover

| Level                         | Tests | Files                                                                                                                                                                                                        | What they prove                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit: domain and services     | 242   | `tests/unit/` (`aqi`, `forecast`, `smog`, `household-risk`, `indoor-impact`, `brief-routine`, `region-policy`, `glance`, `stations`, `assistant`, `infrastructure`, `edge-cases`, `build-web`, `properties`) | Known AQI breakpoint values for both standards, unit conversions and EPA truncation; forecast windows (ties, midnight, constraints); smog-trap grading; every family-risk branch; the indoor mass-balance model; impact factors; GRAP stages; OpenAQ parsing, freshness and unit fixes; calibration; caching, retries and config validation; prompt grounding and sanitisation; the production build |
| Property-based (fast-check)   | 6     | `tests/unit/properties.test.ts`                                                                                                                                                                              | For any input: AQI is bounded and monotonic, the overall AQI is the largest sub-index, indoor PM2.5 falls as filtration rises, the "best" window is never beaten, sanitisation is bounded and idempotent, and 150 random households pass through the whole pipeline with no NaN or broken text                                                                                                       |
| Integration: real Express app | 44    | `tests/integration/` (`api`, `guards-server`, `locate`, `vercel`, `process`)                                                                                                                                 | Security headers, validation, every error status (400/403/404/413/415/429/500/502), the cross-site guard, request IDs, caching and 304s, the Vercel config and serverless entry; `process.test.ts` spawns the real server process and calls it over HTTP                                                                                                                                             |
| Browser UI (jsdom)            | 123   | `tests/frontend/` (`app`, `dom`, `features`, `tabs`, `pure`, `contrast`)                                                                                                                                     | Full user flows: search, every location failure, ARIA tabs with keyboard and back button, family editor validation, chat (including a question sent while one is in flight), share and read-aloud; XSS-safe rendering; **axe-core audits with 0 violations**; contrast of every theme colour pair                                                                                                    |

## How the tests are built

- **Dependency injection instead of module mocks:** services take `fetchFn`, clocks and providers as parameters, and
  the browser app takes `api`, `storage`, `geolocation` and speech objects, so each test passes a fake.
- **Failure paths are first-class:** upstream timeouts, malformed responses, stale stations, GenAI errors and refusals,
  blocked location permission and tampered browser storage each have their own test.
- **Behaviour-preserving refactors are proven:** before/after comparisons (byte-identical GenAI context, identical AQI
  tables, 30,609 intent messages classified identically) were run when the code was restructured.
- **Accessibility is tested, not only claimed:** axe-core runs on the empty and the fully rendered page (with a
  self-test that axe really detects a planted violation), and every text/background pair is checked against WCAG
  contrast ratios in light and dark themes.

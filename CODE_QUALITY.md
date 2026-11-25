# Code quality

How AirWise keeps its code readable, safe to change and easy to verify. Every rule below is enforced in CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) or can be reproduced with one command.

## Verify it yourself

```bash
npm ci
npm run lint            # ESLint: typescript-eslint strictTypeChecked + SonarJS + size/complexity limits
npm run typecheck       # tsc --strict on the server, and on the browser JavaScript via // @ts-check
npm run format:check    # Prettier
npm run test:coverage   # 409 tests with coverage thresholds
npx jscpd src scripts public/js tests --min-tokens 50   # copy-paste detection
```

## Architecture: dependencies point one way

| Layer       | Folder                                         | Responsibility and rules                                                                                                                                                                   |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain      | `src/domain/`                                  | Pure functions with no I/O and no framework imports. Computes every number: AQI (US EPA and India CPCB), forecast windows, smog trap, family risk, indoor model, impact, daily routine.    |
| Services    | `src/services/`                                | All I/O, behind small interfaces: Open-Meteo, OpenAQ, the cache, Gemini/Claude. Injected through factories, so tests pass fakes instead of mocking modules.                                |
| HTTP        | `src/http/`                                    | Express routes, Zod request schemas and middleware (security headers, same-origin guard, rate limits, one error handler).                                                                  |
| Composition | `src/app.ts`, `src/server.ts`, `src/vercel.ts` | The only places that construct real dependencies.                                                                                                                                          |
| Browser     | `public/js/`                                   | `app.js` is the composition root; `shell.js` (page frame), `controllers/` (behaviour), `render/` (DOM output, text nodes only), `api.js`, `storage.js`. Browser capabilities are injected. |

The GenAI model never computes a number: the domain layer builds one `AirBrief`, which feeds the UI, the rule-based
assistant and the model prompt alike, so the chat cannot contradict the page.

## Type safety and validation

- **TypeScript `strict`** plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` and
  `isolatedModules` ([`tsconfig.json`](tsconfig.json)).
- **The browser code is type-checked too:** every module starts with `// @ts-check` and is checked by
  [`tsconfig.client.json`](tsconfig.client.json) against the server's own domain types (`AirBrief`), so the API
  contract and the UI cannot drift apart.
- **Runtime validation at every boundary:** environment config ([`src/config.ts`](src/config.ts)), request bodies and
  queries ([`src/http/schemas.ts`](src/http/schemas.ts)), upstream API responses (`safeParse` in
  [`openMeteo.ts`](src/services/openMeteo.ts) and [`openaq.ts`](src/services/openaq.ts)) and browser storage
  ([`public/js/storage.js`](public/js/storage.js)).
- **No escape hatches:** 0 `any`, 0 `@ts-ignore`/`@ts-expect-error`, 0 `eslint-disable` comments and 0 TODO/FIXME
  in the codebase.

## Enforced limits (CI fails on any breach)

Configured in [`eslint.config.js`](eslint.config.js) for every shipped file (server, build script, browser app):

| Rule                                               | Limit                                         |
| -------------------------------------------------- | --------------------------------------------- |
| Cyclomatic complexity per function                 | ≤ 10                                          |
| Cognitive complexity per function (SonarJS)        | ≤ 15                                          |
| Lines per function (excluding blanks and comments) | ≤ 60                                          |
| Nesting depth                                      | ≤ 3                                           |
| Parameters per function                            | ≤ 4 (an options object beyond that)           |
| Nested callbacks                                   | ≤ 3                                           |
| Regular expressions (SonarJS)                      | no super-linear backtracking; complexity ≤ 20 |

On top of that: `typescript-eslint` **strictTypeChecked** (no floating promises, no unsafe `any` flows, no
deprecated APIs, no confusing void expressions) and the **SonarJS recommended** rules (bug patterns and code smells,
tests included).

## Small units, one definition per fact

- **Short files:** the largest are the AQI breakpoint data table (`src/domain/aqi/standards.ts`, 382 lines), the
  browser composition root (`public/js/app.js`, 307) and the OpenAQ client (`src/services/openaq.ts`, 294).
- **Rules as data, not branches:** Delhi GRAP implications ([`policy.ts`](src/domain/policy.ts)), EPA and CPCB
  breakpoints ([`standards.ts`](src/domain/aqi/standards.ts)), assistant intent keywords
  ([`intent.ts`](src/services/assistant/intent.ts)) and form-field ranges ([`profileForm.js`](public/js/profileForm.js))
  are tables read by one small function each.
- **No copy-paste:** jscpd finds 0 % duplication in `src/`, `scripts/` and `public/js/`. Shared facts have one home:
  gas molecular weights (`calculator.ts`, reused by the OpenAQ unit conversion), the LLM config type (derived from
  `AppConfig`), the `AirBrief` type (shared by server, browser and prompt builder).

## Errors and logging

- **Typed errors:** `AppError`/`UpstreamError` ([`src/lib/errors.ts`](src/lib/errors.ts)) and
  `InsufficientDataError` ([`src/domain/errors.ts`](src/domain/errors.ts)) are mapped to HTTP status codes in one place
  ([`errorHandler.ts`](src/http/middleware/errorHandler.ts)); users get a friendly message, logs keep the detail.
- **Structured JSON logs** ([`src/lib/logger.ts`](src/lib/logger.ts)) carry the `X-Request-Id`; request bodies,
  query strings and secrets are never logged.
- **Graceful degradation instead of crashes:** a failing station is skipped, a failed GenAI call falls back to the
  rule-based assistant, missing keys switch to clearly labelled model data.

## Safe to change

- 409 tests across unit, integration, browser (jsdom) and property-based suites, with coverage thresholds in CI
  (see [`TESTING.md`](TESTING.md)).
- Refactors are proven behaviour-preserving, not assumed: the GenAI context and the AQI tables were compared
  byte-for-byte before and after, and the intent classifier was compared on 30,609 generated messages (0 differences).
- Prettier, EditorConfig, LF line endings, a pre-commit hook config
  ([`.pre-commit-config.yaml`](.pre-commit-config.yaml)) and a written [decisions log](docs/DECISIONS.md).

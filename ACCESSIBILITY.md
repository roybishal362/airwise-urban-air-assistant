# Accessibility

AirWise targets **WCAG 2.2 level AA**. It is used by families under stress, sometimes on old phones, sometimes by
older relatives who prefer listening to reading, so accessibility is part of the design rather than a final check.

## How it is verified

| Check                    | How                                                                                                                                         | Where                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Automated WCAG audit     | axe-core on the empty page and on the fully rendered plan: **0 violations**, plus a self-test proving the audit catches a planted violation | `tests/frontend/dom.test.ts`                                |
| Colour contrast          | Every text/background token pair ≥ 4.5:1 and every UI element ≥ 3:1, in light and dark themes; every AQI category colour pair               | `tests/frontend/contrast.test.ts`, `tests/unit/aqi.test.ts` |
| Keyboard and focus       | ARIA tabs (roving tabindex, Arrow/Home/End, wrap-around), focus moves after search and on errors, Enter/Shift+Enter in chat                 | `tests/frontend/tabs.test.ts`, `app.test.ts`, `dom.test.ts` |
| Error handling for forms | Invalid fields get `aria-invalid`, are linked to their message with `aria-describedby` and receive focus                                    | `tests/frontend/app.test.ts`                                |
| Manual checks            | In Chrome on the live app: the keyboard flow through search, tabs and chat, and reflow at 320 px                                            | live app                                                    |

## What a user gets

- **Structure:** semantic landmarks, a skip link, one `h1` with an ordered heading hierarchy, labelled `fieldset`s and
  inputs, tables with captions and scoped headers ([`public/index.html`](public/index.html)).
- **Screen readers:**
  - Live regions (`role="status"`, chat `role="log"`) and `aria-busy` while loading; errors are announced
    assertively, progress politely ([`public/js/shell.js`](public/js/shell.js)).
  - Tabs follow the WAI-ARIA tabs pattern with a URL per tab, so the back button works
    ([`public/js/controllers/tabs.js`](public/js/controllers/tabs.js)).
  - The page title follows the city and tab ("Forecast · Delhi · AirWise").
  - The hourly chart has a text summary and a screen-reader list of every hour; each chat message names its speaker.
  - Decorative marks (the "live" dot, icons) are hidden from assistive technology.
- **Never colour alone:** every AQI value, bar and badge also carries a text label.
- **Touch and keyboard:** visible focus rings, 44 px touch targets, full keyboard support.
- **Reflow:** nothing scrolls sideways at 320 px; on phones the tab bar becomes a bottom navigation bar.
- **Language:** Hindi answers are tagged `lang="hi"` so screen readers switch voice
  ([`public/js/format.js`](public/js/format.js)).
- **Display preferences:** `prefers-reduced-motion`, `prefers-color-scheme: dark`, `prefers-contrast: more`, Windows
  `forced-colors`, and a print stylesheet ([`public/css/styles.css`](public/css/styles.css)).
- **Listening instead of reading:** a _Read summary aloud_ button (Web Speech API, `en-IN`) and voice input for the
  assistant.
- **Forms:** the city search declares `autocomplete="address-level2"` (WCAG 1.3.5); the family editor validates each
  field with a specific message.

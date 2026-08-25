# Nonsense Tickets

Flat-fee DIY ticketing concept for Philadelphia warehouse nights, basement raves, and
self-hosted shows. **$25 on the flyer = $25 at checkout** — a flat $1 per ticket, promoters
keep the rest.

Source is a [Claude Design](https://claude.ai/code) canvas export (`.dc.html`), imported
2026-08-23 from `Nonsense_Tickets_assets_wired.zip`.

Live inspection: <https://davehomeassist.github.io/nonsense-tickets/>

## Run it

```bash
npm run dev     # http://localhost:5173  (set PORT to change)
npm test        # dependency-free Node tests for event dates, filters, and .ics output
```

No install step — `scripts/dev-server.mjs` is a zero-dependency Node static server
(Node 18+). It exists because `serve` mangles paths on Windows and buries `index.html`
under a directory listing.

The core page can boot without external JavaScript. React 18.3.1 and ReactDOM 18.3.1
are pinned under `src/vendor/` and loaded before `support.js`. The generated runtime still
compiles the canvas template and evaluates its `<script type="text/x-dc">` logic in the
browser; Babel is lazy-loaded only for JSX `x-import` modules, which this canvas does not
use. There is no application build step.

Google Fonts remain external. If they are unavailable, the page renders with its CSS
fallback fonts instead of going blank.

Opening `nonsense-tickets.dc.html` with `file://` will not work; the relative asset and
script fetches need an HTTP origin.

## Layout

```
scripts/
└── dev-server.mjs             local static server, no dependencies
src/
├── index.html                 redirect → the canvas
├── nonsense-tickets.dc.html   the design (markup + <style> + DCLogic component)
├── event-tools.js              normalized dates, discovery matching, and .ics generation
├── support.js                 Claude Design runtime (generated — do not edit)
├── image-slot.js              image-slot custom element (generated — do not edit)
├── .thumbnail                 canvas preview image
├── vendor/                    pinned React/ReactDOM UMD files + license notices
└── assets/                    8 WebPs (706 KB) + 8 PNG fallbacks (9.46 MB)
tests/
└── event-tools.test.mjs       utility behavior and canvas source contracts
```

Application markup lives in `nonsense-tickets.dc.html`. `support.js` and `image-slot.js`
are generated `dc-runtime` artifacts and get overwritten on any re-export; the files in
`vendor/` are pinned third-party distributions and must not be hand-edited.

## What's in it

The served page is the **product as a visitor sees it**, not the design canvas. The
artboard switcher (`aria-label="Prototype views"`) and the Mobile spec board were part of
the presentation, so they're gone — see *Design source* below for how to get them back.

What remains is one site with a real navigation model:

| Surface | How a visitor reaches it |
|---|---|
| Shows listing + marketing | the landing page; search, genre, and rolling date filters combine |
| Event detail | clicking a native fixture; **Add to calendar** downloads a local `.ics` file |
| AfterBreak offers | clicking AfterBreak opens its two-night offer sheet; checkout continues on Linkstub |
| Ticket | completing the buy flow (detail → pay → issued) |
| The math / Promoters | `#fees` / `#promoters` anchors, shown only on the landing page |

**Mobile is not a destination.** The site is already responsive — `matchMedia('(max-width:760px)')`
drives a `narrow` state that collapses the nav to the wordmark and switches the event detail
from a dialog to a dragged bottom sheet. Narrow the window to see it. The old Mobile board
was a picture of that behaviour, captioned `375 × 740 · iPhone class`; keeping it as a tab
implied visitors could navigate to a mobile version of the site, which was never the intent.

State lives in one `DCLogic` component — theme (light/dark), combined show query/genre/date
filters, cart sheet with drag-to-dismiss, quantity, wallet pass, plus accent/header/texture
variants.

The catalog contains six native demo fixtures plus the official externally sold AfterBreak
2026 listing. Every entry uses canonical `startsAt`, `endsAt`, and IANA `timeZone` fields.
AfterBreak additionally uses `sessions`, `offers`, and an HTTPS `checkout` contract: offer
`sessionIds` define the admission grants that a future native ticket will carry. The shared
`NonsenseEventTools` surface validates those references and derives a two-night label from
the two published session starts. Because the official listing does not publish a distinct
Night 1 end time, the prototype refuses to manufacture a multi-session calendar file.

The six native fixtures retain the existing local checkout demonstration and RFC 5545
calendar downloads. AfterBreak never enters that simulated payment or issuance flow;
Linkstub remains responsible for its live payment and tickets until persistent orders,
signed ticket payloads, and session-aware scanning exist.

## Design source

The untouched canvas — both extra artboards, switcher intact — is the first commit:

```bash
git show f29b030:src/nonsense-tickets.dc.html > canvas.dc.html
```

The original export is also still at
`Desktop/00-Inbox/Vivaldi Downloads/Nonsense_Tickets_assets_wired.zip`.

Re-exporting from Claude Design will restore the presentation chrome, so the cuts described
above and the two local React preload tags have to be reapplied after any re-import.

## Design system

Riso/screen-print aesthetic — paper grain, animated registration misprint on the wordmark,
`multiply` blend in light and `screen` in dark.

| Token | Light | Dark |
|---|---|---|
| `--paper` | `#ece8dc` | `#14121c` |
| `--ink` | `#17141f` | `#eae5d8` |
| `--blue` | `#2333c4` | `#5c6bff` |
| `--pink` | `#ff2fa0` | `#ff4fb0` |
| `--acid` | `#c8f542` | `#c8f542` |

Type: Unbounded (700/900) display, Archivo (400–700) body, Space Mono for numerals —
all from Google Fonts. `prefers-reduced-motion` is honored.

## Roadmap

Phased plan, backlog mapping, and risk log in [ROADMAP.md](ROADMAP.md). Two risks there are
blocking rather than theoretical: the flat $1 fee does not cover card processing on a $26
charge, and the receipt copy contradicts the fee logic it sits next to.

## Known gaps

- **Asset optimization is not a repeatable pipeline.** The current eight WebPs total
  705,984 bytes versus 9,463,501 bytes for their retained PNG sources, but event banners
  still flow through the generated `image-slot` using PNG paths. New or re-exported assets
  need a deliberate `cwebp` pass.
- **Not strict-CSP compatible.** Local React removes the critical unpkg boot dependency,
  but the generated runtime evaluates `DCLogic` with `new Function`. Removing `unsafe-eval`
  requires a precompile step or a rebuilt `dc-runtime`, neither of which is in this repo.
- Six entries remain prototype copy and fixture data (`NON-4K2P9X`,
  `instagram.com/concretemass`, `ra.co/events/2088414`). AfterBreak is sourced from the
  official No Nonsense listing but deliberately uses external Linkstub checkout.

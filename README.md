# Nonsense Tickets

Flat-fee DIY ticketing concept for Philadelphia warehouse nights, basement raves, and
self-hosted shows. **$25 on the flyer = $25 at checkout** — a flat $1 per ticket, promoters
keep the rest.

Source is a [Claude Design](https://claude.ai/code) canvas export (`.dc.html`), imported
2026-08-23 from `Nonsense_Tickets_assets_wired.zip`.

## Run it

```bash
npm run dev     # http://localhost:5173  (set PORT to change)
```

No install step — `scripts/dev-server.mjs` is a zero-dependency Node static server
(Node 18+). It exists because `serve` mangles paths on Windows and buries `index.html`
under a directory listing.

**Requires a network connection.** `support.js` pulls React 18, ReactDOM, and
`@babel/standalone` from unpkg at runtime and compiles the `<script type="text/x-dc">`
component block in the browser. Nothing is bundled — there is no build step.

Opening `nonsense-tickets.dc.html` with `file://` will not work; the relative asset and
script fetches need an HTTP origin.

## Layout

```
scripts/
└── dev-server.mjs             local static server, no dependencies
src/
├── index.html                 redirect → the canvas
├── nonsense-tickets.dc.html   the design (markup + <style> + DCLogic component)
├── support.js                 Claude Design runtime (generated — do not edit)
├── image-slot.js              image-slot custom element (generated — do not edit)
├── .thumbnail                 canvas preview image
└── assets/                    8 PNGs, ~9.4 MB
```

Only `nonsense-tickets.dc.html` is hand-editable. `support.js` and `image-slot.js` are
build artifacts of `dc-runtime` and get overwritten on any re-export.

## What's in it

The served page is the **product as a visitor sees it**, not the design canvas. The
artboard switcher (`aria-label="Prototype views"`) and the Mobile spec board were part of
the presentation, so they're gone — see *Design source* below for how to get them back.

What remains is one site with a real navigation model:

| Surface | How a visitor reaches it |
|---|---|
| Shows listing + marketing | the landing page |
| Event detail | clicking a show |
| Ticket | completing the buy flow (detail → pay → issued) |
| The math / Promoters | `#fees` / `#promoters` anchors, shown only on the landing page |

**Mobile is not a destination.** The site is already responsive — `matchMedia('(max-width:760px)')`
drives a `narrow` state that collapses the nav to the wordmark and switches the event detail
from a dialog to a dragged bottom sheet. Narrow the window to see it. The old Mobile board
was a picture of that behaviour, captioned `375 × 740 · iPhone class`; keeping it as a tab
implied visitors could navigate to a mobile version of the site, which was never the intent.

State lives in one `DCLogic` component — theme (light/dark), show filter, cart sheet with
drag-to-dismiss, quantity, wallet pass, plus accent/header/texture variants.

## Design source

The untouched canvas — both extra artboards, switcher intact — is the first commit:

```bash
git show f29b030:src/nonsense-tickets.dc.html > canvas.dc.html
```

The original export is also still at
`Desktop/00-Inbox/Vivaldi Downloads/Nonsense_Tickets_assets_wired.zip`.

Re-exporting from Claude Design will restore the presentation chrome, so the cuts described
above have to be reapplied after any re-import.

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

## Known gaps

- **Assets are uncompressed.** 8 PNGs at ~9.4 MB, several over 1.3 MB each. They want a
  pass through an optimizer (and probably WebP/AVIF) before this goes anywhere real.
- **Not publishable as an Artifact as-is** — a strict CSP would block the unpkg fetches.
  Hosting it means either vendoring React/Babel locally or compiling the component ahead
  of time.
- Content is prototype copy and fixture data (`NON-4K2P9X`, `instagram.com/concretemass`,
  `ra.co/events/2088414`), not real listings.

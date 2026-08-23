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

This is a **design presentation**, not an app with six routes. The top nav switches between
four artboards:

| Board | What it shows |
|---|---|
| **Site** | desktop marketing page + show listings |
| **Event** | a single event detail page |
| **Ticket** | the issued-ticket screen |
| **Mobile** | a spec board — phone mockups in drawn hardware bezels |

`Mobile` is the one to not misread. It is a picture *of* the responsive design: a `375 × 740
· iPhone class` caption over a row of phone frames (10px border, 44px radius, 9:41 status
bar, hard blue drop shadow), labelled `01 · Shows list` and so on. It is not a mobile
version of the canvas and not a surface anyone navigates — resizing the browser will never
take you there. Its own copy makes the point: *"the phone build is the real build."*

The last two nav items aren't boards at all. **The math** and **Promoters** are `#fees` and
`#promoters` anchors that scroll within the Site board.

State lives in one `DCLogic` component — theme (light/dark), show filter, cart sheet with
drag-to-dismiss, quantity, wallet pass, plus accent/header/texture variants. Clicking a show
on the Site board switches to Event with that show loaded, so the boards are wired to each
other rather than being independent comps.

Canvas-editable props:

| Prop | Editor | Default | Range |
|---|---|---|---|
| `flatFee` | int | `1` | $0–$5 |
| `misregistration` | range | `6px` | 0–14px |
| `textureIntensity` | range | `1` | 0.3–1.8 |
| `sheetPresentation` | enum | `auto` | auto / sheet / dialog |

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

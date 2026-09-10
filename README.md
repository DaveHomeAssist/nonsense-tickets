# Nonsense Tickets

Flat-fee DIY ticketing concept for Philadelphia warehouse nights, basement raves, and
self-hosted shows. **The price on the flyer is the price at checkout** — face value plus
a flat $2 per ticket, shown all-in everywhere. Card processing comes out of the $2, so
promoters keep the full face value.

Source is a [Claude Design](https://claude.ai/code) canvas export (`.dc.html`), imported
2026-08-23 from `Nonsense_Tickets_assets_wired.zip`.

Live inspection: <https://davehomeassist.github.io/nonsense-tickets/>

## Run it

```bash
npm run dev              # http://localhost:5173  (set PORT to change)
npm test                 # Node test suite: catalog contract, dates/filters/.ics, signed tickets,
                         # manifests, issuance, scanner admission rules, QR round trips, PWA assets
npm run scanner:fixture  # disposable public-only kit for the physical-phone scanner test
```

No install step — `scripts/dev-server.mjs` is a zero-dependency Node static server
(Node 18+; the tests use WebCrypto and `node --test`, so Node 20+ for those). The only
package in `package.json` is `jsqr`, pinned as the vendoring source for
`src/scanner/vendor/jsQR.js`; nothing imports it at runtime or in the tests. The dev
server exists because `serve` mangles paths on Windows and buries `index.html` under a
directory listing.

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
├── dev-server.mjs                       local static server, no dependencies
└── generate-scanner-phone-fixture.mjs   public-only scanner qualification kit (also run by CI deploy)
src/
├── index.html                 redirect → the canvas
├── nonsense-tickets.dc.html   the storefront (markup + <style> + DCLogic component)
├── event-catalog.js           the show catalog: the only definition of a show on the storefront
├── event-tools.js             event contract, normalized dates, discovery matching, .ics generation
├── ticket-schema.js           persistent record contracts: event, session, offer, order, ticket,
│                              entitlement, redemption, scanner device, plus catalog integrity
├── ticket-payload.js          NT1 signed ticket payload (ECDSA P-256, WebCrypto)
├── ticket-manifest.js         NTM1 signed offline manifest a door device trusts
├── ticket-issuer.js           server side issuance and transfer (never loaded by the scanner)
├── scanner-core.js            offline admission decision engine and server reconciliation
├── qr-encode.js               real QR encoder (ISO/IEC 18004, level M)
├── scanner/                   door scanner PWA: index.html, scanner-app.js, qr-decoder.js,
│                              sw.js, app.webmanifest, vendor/jsQR.js
├── support.js                 Claude Design runtime (generated — do not edit)
├── image-slot.js              image-slot custom element (generated — do not edit)
├── .thumbnail                 canvas preview image
├── vendor/                    pinned React/ReactDOM UMD files + license notices
└── assets/                    8 WebPs (706 KB) + 8 PNG fallbacks (9.46 MB)
tests/
├── event-catalog.test.mjs     every shipped catalog entry against the event contract
├── event-tools.test.mjs       utility behavior and canvas source contracts
├── ticket-security.test.mjs   forgery, wrong event, duplicates, combo, revocation, transfer,
│                              two-device reconciliation, persistent schema integrity
├── qr-encode.test.mjs, qr-roundtrip.test.mjs, scanner-decoder.test.mjs,
├── scanner-phone-fixture.test.mjs, scanner-pwa.test.mjs
docs/
├── superpowers/specs/         design specs (scanner security core, jsQR fallback, AfterBreak)
├── superpowers/plans/         implementation plans
└── testing/scanner-phone-matrix.md   physical-phone gate; not yet run
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

The catalog is `src/event-catalog.js`, loaded before the runtime and read by the cards, the
detail sheet, the checkout math, calendar export, and the tests; no card or page carries its
own copy of a title, price, date, or sale status. It contains six native demo fixtures plus
the official externally sold AfterBreak 2026 listing. Every entry uses canonical `startsAt`,
`endsAt`, and IANA `timeZone` fields and is validated against
`NonsenseEventTools.validateEvent` in CI.
AfterBreak additionally uses `sessions`, `offers`, and an HTTPS `checkout` contract: offer
`sessionIds` define the admission grants that a future native ticket will carry. The shared
`NonsenseEventTools` surface validates those references and derives a two-night label from
the two published session starts. Because the official listing does not publish a distinct
Night 1 end time, the prototype refuses to manufacture a multi-session calendar file.

The six native fixtures retain the existing local checkout demonstration and RFC 5545
calendar downloads. The demo checkout is gated and labeled: it charges nothing, writes no
order record, and renders a decorative QR grid with a random `NON-` code, not a signed
payload. AfterBreak never enters that simulated flow; Linkstub remains responsible for its
live payment and tickets until persistent orders and a real issuance service exist.

## Door scanner and ticket contracts

The door side of the product exists as a verification-only vertical slice, separate from
the storefront:

- `ticket-schema.js` defines the persistent records (events, sessions, offers, orders,
  tickets, entitlements, redemptions, scanner devices) with money in integer cents and the
  core invariant of at most one admitted redemption per `(ticketId, sessionId)`.
- `ticket-payload.js` and `ticket-manifest.js` define the `NT1` signed ticket and the
  `NTM1` signed manifest. A door device pins a publisher public key at enrollment; a
  manifest is trusted only if it verifies against that key, and only then are the ticket
  signing keys it carries usable. Manifest versions are monotonic per device.
- `scanner-core.js` decides admission offline against the installed manifest and a local
  redemption log, and reconciles queued batches from several devices deterministically.
- `src/scanner/` is the installable PWA: enrollment, camera or manual entry, verdicts,
  a `localStorage` scan queue, and JSON export of the queue. It is served at
  `/scanner/` on the Pages site. Native `BarcodeDetector` is used when present, the
  vendored `jsQR` otherwise.

What does not exist, per `docs/superpowers/specs/2026-08-24-scanner-core-security-hardening.md`:
an issuance service or key custody, a manifest publishing API, device enrollment or
authentication, upload or sync of the scan queue (export is a manual JSON download), and
any link from the storefront's demo checkout to these contracts. The only manifest and
ticket producer in the repository is the qualification kit script. The physical-phone gate
in `docs/testing/scanner-phone-matrix.md` has not been run.

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

Phased plan, backlog mapping, and risk log in [ROADMAP.md](ROADMAP.md). The fee-model
decision (R1/R2) is resolved: a flat $2 per ticket added to face value, shown all-in on
the flyer, the card, and checkout, with card processing paid out of the flat fee — so
"promoters keep the face value" is arithmetically true.

## Known gaps

- **Asset optimization is not a repeatable pipeline.** The current eight WebPs total
  705,984 bytes versus 9,463,501 bytes for their retained PNG sources, but event banners
  still flow through the generated `image-slot` using PNG paths. New or re-exported assets
  need a deliberate `cwebp` pass.
- **Not strict-CSP compatible.** Local React removes the critical unpkg boot dependency,
  but the generated runtime evaluates `DCLogic` with `new Function`. Removing `unsafe-eval`
  requires a precompile step or a rebuilt `dc-runtime`, neither of which is in this repo.
- Six entries remain prototype copy and fixture data (`instagram.com/concretemass`,
  `ra.co/events/2088414`, promoter copy, door rules). AfterBreak is sourced from the
  official No Nonsense listing but deliberately uses external Linkstub checkout.
- **The storefront and the door share no data contract yet.** The catalog uses whole
  dollars, `price`, and a `tag` vocabulary for display; `ticket-schema.js` uses integer
  cents, `facePriceCents` plus `feeCents` per offer, and status enums. The six native
  fixtures have no `sessions` or `offers`, so the native cutover described in the AfterBreak
  design needs an adapter or a reshaped catalog. The demo checkout does not produce an
  `order` record and there is no API client boundary on the storefront.
- **Scanner output is not yet a persistent redemption record.** Queue entries carry
  `scanId` and `scannedAt` as epoch seconds; `validateRedemptionRecord` expects a
  server assigned `id` and ISO instants. The conversion belongs to the future
  reconciliation endpoint and does not exist here.

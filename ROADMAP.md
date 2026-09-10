# Nonsense Tickets — Development Roadmap

Current state: a Claude Design canvas served as a static page. The catalog
(`src/event-catalog.js`) contains six native demo fixtures plus an official AfterBreak
2026 entry with two sessions, three entitlement-bearing offers, and external Linkstub
checkout. Alongside the storefront, a verification-only door slice exists: persistent
record contracts (`ticket-schema.js`), signed `NT1` tickets and `NTM1` manifests, server
side issuance and transfer, an offline admission engine with reconciliation, a real QR
encoder, and an installable scanner PWA at `/scanner/`. A Node test suite and GitHub Pages
CI cover both; there is still no persistence, application data API, issuance service, or
key custody, and the storefront's demo checkout does not touch the door contracts. React
and ReactDOM are served locally; Google Fonts remain external. Everything below assumes
that starting point, not a greenfield repo.

Durations assume one to two engineers. Phases are sequential except where noted.

| Phase | Core Objective | Key Deliverables | Typical Duration |
| --- | --- | --- | --- |
| **Phase 0: Discovery & Feasibility** | Settle the unit economics and decide what the product actually commits to — before a backend is built around claims the design already makes. | Fee-model decision (R1), payment/settlement design, shows-orders-tickets schema, ticket-forgery threat model, risk log. **Parallel no-backend track:** scoped asset optimization, accessibility, `.ics` export, and combined search/date filtering complete | Weeks 1–3 |
| **Phase 1: Foundation & MVP** | Replace fixtures with a real data layer and make one show sellable end to end. | Database schema, promoter auth, payment integration + next-day payout, signed ticket payloads, real QR encoder, strict-CSP runtime precompile, transactional email | Weeks 4–12 |
| **Phase 2: Alpha & User Validation** | Run real doors at friendly promoters' shows. | Offline door-scanner PWA, sold-out waitlist, analytics, feedback log from 3–5 pilot shows, door-staff observation notes | Weeks 13–17 |
| **Phase 3: Beta & Hardening** | Survive an on-sale spike and a venue with no signal. | On-sale burst load test, pen test against forgery/replay, offline scanner conflict resolution, face-value transfer, SLO baselines | Weeks 18–22 |
| **Phase 4: General Availability** | Public rollout and monitoring. | Production deployment, door-staff runbook, promoter onboarding docs, incident runbooks, marketing kickoff | Weeks 23–24 |
| **Phase 5: Post-Launch & Iteration** | Maintain stability and open the promoter side. | Promoter dashboard (payouts + list export), patch releases, performance work, roadmap v2 | Ongoing |

---

## Backlog Mapping

| # | Feature | Status | Phase | Effort | Backend | Impact | Blocked by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Current-asset optimization (WebP + `<picture>`) | **Complete (scoped)** (`e3538fc`) | 0 (parallel) | S | No | High | — |
| 2 | Accessibility implementation (`lang`, `aria-live`) | **Complete (scoped)** (`e3538fc`) | 0 (parallel) | S | No | High | — |
| 3 | Add to calendar (.ics) | **Complete (scoped)** (`e3d048d`) | 0 (parallel) | S | No | Medium | — |
| 4 | Search + date filtering | **Complete (scoped)** (`fdc4498`) | 0 (parallel) | S | No | Medium | — |
| 5 | Runtime CDN independence / strict-CSP precompile | **Partial** (CDN independent; precompile blocked) | 1 | M | No | High | Precompile: `dc-runtime` source/build access |
| 6 | Persistence + real data layer | **Blocked** (record contracts exist in `ticket-schema.js`; no storage, API, or storefront adapter) | 1 | L | Yes | Critical | storage and API decision |
| 7 | Real scannable QR + offline door scanner | **Partial** (`f856ee1`: signed payloads, manifest, engine, encoder, PWA; no issuance service; physical-phone gate not run) | 1 → 2 | L | Yes | Critical | 6 for live tickets |
| 8 | Face-value ticket transfer | **Blocked** | 3 | M–L | Yes | High | 6, 7 |
| 9 | Sold-out waitlist capture | **Blocked** | 2 | M | Yes | High | 6 |
| 10 | Promoter dashboard (payouts + list export) | **Blocked** | 5 | L | Yes | High | 6, payouts |

Items 1–4 shipped within their stated scopes. The frontend also models AfterBreak as one
multi-session event with offer-to-session grants while preserving Linkstub as the only live
checkout. Manual assistive-technology validation and a
repeatable image pipeline remain follow-up work. Calendar export and discovery share one
normalized event-date model and remain backend independent. Item 5 no longer depends on
unpkg to boot, but strict-CSP precompilation remains blocked. Item 7's door side shipped as
a verification-only slice; it becomes real when item 6 supplies persisted orders and an
issuance service that signs tickets and publishes manifests. Items 8–10 remain behind item
6. R1 is resolved, so item 6 is blocked only on the storage and API decision.

### Grounded feature rationale

| # | Current-state justification |
| --- | --- |
| 1 | The eight retained PNG sources total 9,463,501 bytes. Their WebP siblings total 705,984 bytes, a measured 92.54% source-set reduction; seven rendered `<img>` references use `<picture>` with PNG fallback. Event banners still receive PNG paths through the generated `image-slot`, and no repeatable encoding script exists. |
| 2 | The document declares `lang="en"`, and three polite live regions announce filter-result counts, the detail → pay → issued purchase progression, and completed calendar downloads. The implementation was browser-verified, but no manual screen-reader signoff has been performed. |
| 3 | Each native fixture detail view downloads a deterministic RFC 5545 `.ics` file built locally from canonical `startsAt`, `endsAt`, and `timeZone` fields. UTC conversion covers both daylight and standard time, exported locations use only public fixture copy, and the action announces completion through a polite live region. AfterBreak calendar export is deliberately unavailable because its official listing does not publish a distinct Night 1 end time. |
| 4 | Search across titles, venues, genres, and lineups combines with genre and rolling date filters using AND semantics. Visible counts, pressed states, a resettable zero state, keyboard operation, and polite result announcements are covered by unit and fixed-clock browser checks. |
| 5 | React 18.3.1 and ReactDOM 18.3.1 are pinned locally, so unpkg availability no longer controls page boot. Babel is lazy-loaded only for JSX `x-import` modules, which the current canvas does not use. Strict CSP remains blocked because the generated runtime evaluates `DCLogic` with `new Function`; resolving that requires precompilation or a rebuilt runtime. |
| 6 | All seven catalog entries live in `src/event-catalog.js`, validated against the event contract in CI. AfterBreak proves the intended `event → sessions → offers` shape, and `ticket-schema.js` defines the persistent shows, sessions, offers, orders, tickets, entitlements, redemptions, and devices with referential integrity checks. There is no persistence or application data API, the demo checkout produces no `order` record, and the catalog's display shape (dollars, `price`, `tag`) is not the schema's (cents, `facePriceCents` + `feeCents`, status enums); the six native fixtures also carry no `sessions` or `offers`. Item 6 is the adapter or reshape plus storage; it is the prerequisite for live tickets on items 7–10. |
| 7 | The door side exists: `NT1` signed payloads, `NTM1` signed manifests pinned to a publisher key, an offline engine keyed by `(ticketId, sessionId)` so a combo ticket admits once on each granted night, deterministic two-device reconciliation, a real QR encoder, and the `/scanner/` PWA with a `localStorage` queue and JSON export. The storefront ticket still renders a decorative grid because nothing on the site can sign a payload without an issuance service, scan queues are exported by hand rather than synced, and the physical-phone gate in `docs/testing/scanner-phone-matrix.md` has not been run. |
| 8 | There is no transfer or refund flow. Face-value transfer keeps the no-junk-fees position intact when a buyer can no longer attend. |
| 9 | “Sold out · waitlist at the door” is copy only. A functional waitlist would capture the highest-intent audience while supporting the “YOUR LIST, YOUR DATA” promise. |
| 10 | The site promises next-day payouts and audience ownership, but `#promoters` remains marketing content rather than an operational promoter surface. |

AVIF requires installing an encoder; `avifenc` is not present on this machine. The current
WebPs were encoded with `cwebp`, but no repeatable asset-pipeline script exists yet.

---

## Risk Log

**R1 — RESOLVED 2026-08-26: the flat fee is $2 and absorbs card processing.**

The original $1 flat fee was loss-making: at typical US card rates (roughly 2.9% + 30¢),
processing a $26 charge costs about $1.05 — more than the entire fee. Decision, from the
options listed at audit time: raise the flat fee to **$2 per ticket**, keep it fan-side,
and pay card processing out of it. On a $27 all-in charge, processing is about $1.08,
leaving roughly $0.92 gross per ticket before infrastructure and support. `flatFee` now
defaults to 2 (`fee()` falls back to 2), and the payment/settlement design in Phase 1
builds on this: fan pays face + $2, promoter is settled the full face value, Nonsense
owns the processing cost. Revisit only if payment rails with materially lower
per-transaction cost become available.

**R2 — RESOLVED 2026-08-26 with R1: all-in framing everywhere.**

The "same number three times" claim now means the **all-in** number (face + $2): it is
what the flyer prints, what the show card displays (`data-price` renders face + fee), and
what checkout charges. The hero, marquee, fee panel, receipt, and README all state that
processing comes out of the flat fee and promoters keep the whole face value — no copy
implies that face value alone is the checkout price anymore.

**R3 — "Door scan works offline" is half true.** The scanner PWA verifies signed tickets
offline against a signed manifest, and the automated suite proves the admission rules. But
no ticket sold or previewed on the site is signed, so a promoter demo that scans the site's
own ticket gets NOT A TICKET; the storefront and the scanner only meet once an issuance
service exists (item 6). The marquee copy still reads as a shipped end to end feature.

**R4 — Scalping undermines the entire positioning.** Flat-fee pricing is a stance, and
resale at 3x makes it cosmetic. Transfer (item 8) is the mitigation, currently scheduled
in Phase 3 — consider pulling it forward if launch gets press.

**R5 — Strict-CSP precompilation remains blocked.** React and ReactDOM are now served
locally, so a captive portal or unpkg outage no longer prevents the page from booting.
However, the generated runtime evaluates `DCLogic` with `new Function`, which requires
`unsafe-eval`. Strict-CSP hosting needs a precompile step or rebuilt `dc-runtime`; neither
the runtime source nor its build system is present in this repository.

---

## Strategic Milestones & Governance

* **Definition of Ready:** an item is ready when it has acceptance criteria, an API contract,
  and a visual spec. The visual spec usually already exists — the design canvas is preserved
  at commit `f29b030` and covers the site, event, ticket, and mobile layouts. New surfaces
  need a new artboard before they enter development.
* **Definition of Done:** passing CI, and test coverage on the paths where being wrong costs
  money or admits the wrong person — fee calculation, payment/settlement, ticket issuance,
  and scan validation. Coverage elsewhere is opportunistic until Phase 3.
* **Release Cadence:** continuous deploy to staging, promoted to production on a weekly
  cadence during Phases 1–3, then per-release at GA. Never deploy on a show day.
* **Operational Health Metrics:** the meaningful SLO is door throughput, not uptime —
  target p99 scan validation under 500 ms with the venue offline, and zero false rejections
  of valid tickets. Track alongside on-sale error rate, payout latency against the advertised
  next-day promise, MTTR, and deployment frequency.

### Deviations from the standard template

Three substitutions, made deliberately:

1. **80% blanket coverage → risk-weighted coverage.** The project has zero tests today.
   A blanket target either blocks everything or gets waived immediately; naming the four
   paths that must be covered is enforceable from day one.
2. **Two-peer code review → one reviewer, plus mandatory review on money and ticket-validity
   paths.** A two-peer rule on a one-to-two person team is unenforceable theater.
3. **Feature-flag platform (LaunchDarkly/Unleash) → the canvas prop system.** The design
   already exposes typed, bounded props (`flatFee`, `misregistration`, `textureIntensity`,
   `sheetPresentation`). A hosted flag platform is not justified until there is a team large
   enough to need flag governance.

Phase durations are also roughly double the template's, which assumes a staffed team.

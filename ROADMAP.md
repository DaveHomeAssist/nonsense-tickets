# Nonsense Tickets — Development Roadmap

Current state: a Claude Design canvas served as a static page. Four shows of fixture data,
no persistence, no network calls, no tests, no CI. Everything below assumes that starting
point, not a greenfield repo.

Durations assume one to two engineers. Phases are sequential except where noted.

| Phase | Core Objective | Key Deliverables | Typical Duration |
| --- | --- | --- | --- |
| **Phase 0: Discovery & Feasibility** | Settle the unit economics and decide what the product actually commits to — before a backend is built around claims the design already makes. | Fee-model decision (R1), payment/settlement design, shows-orders-tickets schema, ticket-forgery threat model, risk log. **Parallel no-backend track:** asset pipeline, accessibility pass, .ics export, search + date filter | Weeks 1–3 |
| **Phase 1: Foundation & MVP** | Replace fixtures with a real data layer and make one show sellable end to end. | CI/CD pipeline (none today), database schema, promoter auth, payment integration + next-day payout, signed ticket payloads, real QR encoder, vendored runtime, transactional email | Weeks 4–12 |
| **Phase 2: Alpha & User Validation** | Run real doors at friendly promoters' shows. | Offline door-scanner PWA, sold-out waitlist, analytics, feedback log from 3–5 pilot shows, door-staff observation notes | Weeks 13–17 |
| **Phase 3: Beta & Hardening** | Survive an on-sale spike and a venue with no signal. | On-sale burst load test, pen test against forgery/replay, offline scanner conflict resolution, face-value transfer, SLO baselines | Weeks 18–22 |
| **Phase 4: General Availability** | Public rollout and monitoring. | Production deployment, door-staff runbook, promoter onboarding docs, incident runbooks, marketing kickoff | Weeks 23–24 |
| **Phase 5: Post-Launch & Iteration** | Maintain stability and open the promoter side. | Promoter dashboard (payouts + list export), patch releases, performance work, roadmap v2 | Ongoing |

---

## Backlog Mapping

| # | Item | Phase | Effort | Backend | Blocked by |
| --- | --- | --- | --- | --- | --- |
| 1 | Asset optimization (WebP + `<picture>`) | 0 (parallel) | S | No | — |
| 2 | Accessibility pass (`lang`, `aria-live`) | 0 (parallel) | S | No | — |
| 3 | Add to calendar (.ics) | 0 (parallel) | S | No | — |
| 4 | Search + date filtering | 0 (parallel) | S | No | — |
| 5 | Vendor runtime / precompile | 1 | M | No | — |
| 6 | Persistence + real data layer | 1 | L | Yes | Phase 0 schema |
| 7 | Scannable QR + offline door scanner | 1 → 2 | L | Yes | 6 |
| 8 | Face-value ticket transfer | 3 | M–L | Yes | 6, 7 |
| 9 | Sold-out waitlist capture | 2 | M | Yes | 6 |
| 10 | Promoter dashboard | 5 | L | Yes | 6, payouts |

Items 1–4 are unblocked today and gate nothing. Ship them during Phase 0 rather than
holding them behind discovery.

AVIF requires installing an encoder; `avifenc` is not present on this machine.

---

## Risk Log

**R1 — The flat $1 fee does not cover card processing. (Critical, economic)**

`fee()` returns the `flatFee` prop and `fanPays` computes `price + fee`, so a $25 ticket
charges the fan $26. At typical US card rates (roughly 2.9% + 30¢), processing a $26 charge
costs about $1.05 — more than the entire $1 fee, before any infrastructure or support cost.
The core promise is currently loss-making per ticket. Options: raise the flat fee, charge
the promoter a per-show fee, absorb processing into a subscription, or push toward payment
rails with lower per-transaction cost. **This decision blocks Phase 1** — the payment
integration cannot be designed without it.

**R2 — The fee copy contradicts the fee logic. (High, product)**

The receipt panel says *"Shown on the flyer, shown on the card, charged at checkout. Same
number three times"* while the same panel itemizes a `Nonsense flat $1` line and a `Fan pays`
total of $26. Those cannot both be true. Either the fan pays the flyer price and the $1 comes
out of the promoter's side, or the fan pays flyer + $1 and the "same number three times" copy
has to go. This is a positioning decision, not a bug fix — resolve it with R1.

**R3 — "Door scan works offline" is unimplemented.** The hero marquee advertises it; the
ticket QR is a decorative CSS grid rendered from `NON-4K2P9X`. Any promoter demo invites a
question the build cannot answer yet.

**R4 — Scalping undermines the entire positioning.** Flat-fee pricing is a stance, and
resale at 3x makes it cosmetic. Transfer (item 8) is the mitigation, currently scheduled
in Phase 3 — consider pulling it forward if launch gets press.

**R5 — Runtime depends on a third-party CDN at page load.** React, ReactDOM, and Babel are
fetched from unpkg and compiled in-browser on every visit. A captive-portal venue wifi or a
CDN outage yields a blank page. Item 5 removes this.

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

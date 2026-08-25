# AfterBreak Multi-Session External Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an honest, accessible AfterBreak two-night catalog entry whose three offers hand checkout to Linkstub while native payment and issuance remain disabled.

**Architecture:** Extend the dependency-free event utility to validate optional sessions, offers, and an external checkout contract. Keep the generated canvas runtime untouched; use the canvas as the UI adapter and switch the existing detail sheet between native and external content from derived selected-event state.

**Tech Stack:** Browser JavaScript, Claude Design `DCLogic` canvas markup, Node.js built-in test runner, Playwright CLI, GitHub Pages.

---

### Task 1: Multi-session domain validation

**Files:**
- Modify: `tests/event-tools.test.mjs`
- Modify: `src/event-tools.js`

- [ ] **Step 1: Write failing validation and formatting tests**

Add an AfterBreak fixture with two session starts, three entitlement-bearing offers, and an
external checkout contract. Assert the derived label is
`2 NIGHTS · FRI SEP 11 + SAT SEP 12 · 11:45PM EACH NIGHT`. Assert duplicate IDs, unknown
session references, negative prices, and non-HTTPS checkout URLs are rejected.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test`

Expected: the new multi-session expectations fail because `validateEvent` and
`formatEventDate` do not yet understand `sessions`, `offers`, or `checkout`.

- [ ] **Step 3: Implement minimal utility support**

Extend `validateEvent` to return validated optional session, offer, and checkout records.
Extend `formatEventDate` to derive a multi-night label from session starts. Include session
and offer labels in search matching. Reject calendar generation when a multi-session record
lacks exact session end timestamps.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm test`

Expected: all utility tests pass with no failures.

### Task 2: AfterBreak discovery and external handoff

**Files:**
- Modify: `tests/event-tools.test.mjs`
- Modify: `src/nonsense-tickets.dc.html`

- [ ] **Step 1: Write failing canvas contract tests**

Assert the canvas contains seven cards, an AfterBreak entry with two sessions and three
offers, the exact Linkstub URL, a semantic external-offer list, an accessible handoff link,
and separate native/external checkout containers.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test`

Expected: canvas contract assertions fail because the AfterBreak fixture and sheet do not
exist.

- [ ] **Step 3: Implement the smallest canvas change**

Add the seventh card in chronological visual order. Add event ID `7`, its sessions, offers,
and external checkout contract. Route that card to the existing sheet, render offer values
from the selected event, and hide native quantity/payment/issuance controls for external
events. Do not edit `src/support.js`, `src/image-slot.js`, or `fee()`.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm test`

Expected: the complete suite passes.

### Task 3: Current-state documentation

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Document the deployed boundary**

Record seven catalog entries, the external AfterBreak checkout, the event/session/offer
shape, and native cutover dependencies on roadmap items 6 and 7. Do not claim native
payment, issuance, or scanning.

- [ ] **Step 2: Verify documentation consistency**

Run: `rg -n "six shows|six fixture|AfterBreak|external checkout|session" README.md ROADMAP.md`

Expected: no stale six-event current-state claim remains and the native dependency is clear.

### Task 4: Release verification

**Files:**
- Verify: `src/nonsense-tickets.dc.html`
- Verify: `src/event-tools.js`

- [ ] **Step 1: Run static verification**

Run: `npm test`, `node --check src/event-tools.js`, extract the `text/x-dc` block into
`node --check -`, run `git diff --check`, and confirm balanced `sc-if` tags.

- [ ] **Step 2: Verify in a real browser**

At desktop and narrow widths, confirm the seventh card, two-night label, three offer rows,
external checkout link, keyboard operation, accessible names, and unchanged native flow.

- [ ] **Step 3: Commit and deploy**

Commit the scoped files on `master`, push `origin/master`, and watch the existing Pages
workflow to completion.

- [ ] **Step 4: Verify production**

Confirm public HTTP 200 responses, inspect the live DOM in a real browser, confirm local and
remote SHAs match, and confirm `git status` is clean.

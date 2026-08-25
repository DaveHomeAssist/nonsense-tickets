# AfterBreak Multi-Session External Checkout Design

## Objective

Represent AfterBreak 2026 honestly in the static Nonsense Tickets prototype without
pretending that Nonsense can yet take payment, issue durable tickets, or validate admission.
The event appears once in discovery, exposes its two sessions and three live offers, and
hands checkout to the official Linkstub listing.

## Source facts

The official listing at `https://linkstub.com/en/ab26` identifies AfterBreak 2026 as a
two-night No Nonsense event. It publishes Night 1 and Night 2 starts at 11:45 PM on
September 11 and 12, 2026, an overall finish at 6:30 AM on September 13, and these offers:

- GA Night 1 Early Bird: $25 face value, $29.77 Linkstub total.
- GA Night 2 Early Bird: $25 face value, $29.77 Linkstub total.
- GA Night 1 + 2 Combo Early Bird: $40 face value, $46.25 Linkstub total.

The listing does not publish a distinct Night 1 end timestamp. The prototype must not
invent one.

## Architecture

The event remains one catalog entry with the exact published overall `startsAt`, `endsAt`,
and `timeZone` fields used by discovery. Optional `sessions` provide stable session IDs,
labels, and published start timestamps. Optional `offers` provide stable offer IDs, labels,
face prices, Linkstub totals, and `sessionIds` that define future admission entitlements.

```js
{
  id: 'afterbreak-2026',
  sessions: [
    {id: 'night-1', label: 'Night 1', startsAt: '2026-09-11T23:45:00-04:00'},
    {id: 'night-2', label: 'Night 2', startsAt: '2026-09-12T23:45:00-04:00'}
  ],
  offers: [
    {id: 'night-1-early-bird', sessionIds: ['night-1'], facePrice: 25, externalTotal: 29.77},
    {id: 'night-2-early-bird', sessionIds: ['night-2'], facePrice: 25, externalTotal: 29.77},
    {id: 'combo-early-bird', sessionIds: ['night-1', 'night-2'], facePrice: 40, externalTotal: 46.25}
  ],
  checkout: {mode: 'external', provider: 'Linkstub', url: 'https://linkstub.com/en/ab26'}
}
```

`NonsenseEventTools.validateEvent` validates unique session and offer IDs, optional session
end ordering, offer-to-session references, nonnegative prices, and HTTPS external checkout
URLs. `formatEventDate` derives the two-night label from session starts. Search includes
session and offer labels. Calendar generation rejects multi-session records that lack exact
session end times rather than emitting a misleading continuous event.

## Interface and behavior

The existing brutalist/riso visual system stays intact. A seventh discovery card uses the
existing No Nonsense logo, a visible “2 nights” marker, the derived session label, and
external-sale pricing language. Activating the card opens the existing ticket-detail sheet
on the current page.

For AfterBreak, the sheet replaces native quantity, payment, and issuance controls with a
semantic list of the three official offers and one native anchor to Linkstub. Copy states
that Linkstub handles payment and ticket issuance. The native checkout remains unchanged
for the six existing fixtures, including all fee calculations and copy.

## Accessibility

The new card remains a native button with an event-specific accessible name. The offer
collection is a semantic list, not a fake selector, because the external URL cannot carry a
selected offer. The Linkstub handoff is a native link with a descriptive accessible name,
`target="_blank"`, and `rel="noopener noreferrer"`. Opening the sheet announces that the
external ticket options are available.

## Native cutover boundary

Native checkout is deferred until roadmap item 6 provides persistent events, offers,
orders, and tickets, and item 7 provides signed ticket payloads plus scanner validation.
At cutover, each issued ticket receives the selected offer's session entitlements and door
redemption is keyed by `(ticketId, sessionId)`, allowing a combo ticket to scan once on each
night without permitting duplicate admission within one session.

## Files and validation

- `src/event-tools.js`: optional session/offer validation and derived multi-session labels.
- `src/nonsense-tickets.dc.html`: AfterBreak data, discovery card, external detail sheet,
  and external/native display switching.
- `tests/event-tools.test.mjs`: utility behavior and canvas source contracts.
- `README.md` and `ROADMAP.md`: current-state and dependency documentation.

Validation requires a red-green test cycle, the full Node suite, `node --check` for both
JavaScript surfaces, balanced `sc-if` tags, local HTTP checks, desktop and narrow browser
inspection, successful GitHub Pages deployment, public HTTP checks, and a clean worktree.

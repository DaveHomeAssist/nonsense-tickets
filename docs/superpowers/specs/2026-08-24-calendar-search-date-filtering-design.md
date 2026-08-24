# Calendar, Search, and Date Filtering Design

**Status:** Approved for implementation planning on 2026-08-24

## Objective

Complete ROADMAP.md items 3 and 4 as one frontend tranche: introduce one normalized
event-date model, generate standards-compliant calendar downloads from that model, and
add scalable search plus date filtering to the existing show listing.

The work remains backend-independent. It must preserve the current purchase behavior,
fee logic and copy, fixture prices, assets, local React runtime, and generated
`src/support.js` and `src/image-slot.js` artifacts.

## Decisions

- Implement both calendar export and search/date filtering together.
- Use a small dependency-free classic script, `src/event-tools.js`, for pure date,
  filtering, and RFC 5545 functions. It exposes a frozen
  `globalThis.NonsenseEventTools` API and is synchronously loaded before `support.js`.
  Node tests import the same file for its global side effect, so browser and test code
  exercise one implementation.
- Keep the Claude Design canvas as the UI adapter. Do not migrate frameworks or edit
  generated runtime files.
- Treat all six fixtures as a coherent 2026 demo calendar in
  `America/New_York`. The inconsistent Afterjinx fixture becomes Saturday,
  December 26, 2026, 1AM–3AM.
- Search title, public venue/neighborhood, genre, and lineup.
- Use rolling quick ranges: All dates, Next 7 days, Next 30 days, and Later.
- Use the approved layered layout: search, date chips, and then existing genre chips
  above the grid. Put Add to calendar in the event detail's existing utility card so it
  does not compete with checkout.
- Calendar locations reproduce the public venue string exactly. The implementation must
  never infer, expose, or substitute a hidden address.
- Calendar export is described as a file download, not as direct insertion into a
  calendar application.

## Canonical Event-Date Model

Each event replaces the ambiguous display-only `date` property with these required
fields:

```js
{
  startsAt: "2026-09-04T22:00:00-04:00",
  endsAt: "2026-09-05T04:00:00-04:00",
  timeZone: "America/New_York"
}
```

The exact fixture timestamps are:

| ID | Event | `startsAt` | `endsAt` | `timeZone` |
| --- | --- | --- | --- | --- |
| 1 | Concrete Mass 014 | `2026-09-04T22:00:00-04:00` | `2026-09-05T04:00:00-04:00` | `America/New_York` |
| 2 | Sweat Equity | `2026-09-05T21:00:00-04:00` | `2026-09-06T02:00:00-04:00` | `America/New_York` |
| 3 | Low End Census | `2026-09-11T22:00:00-04:00` | `2026-09-12T03:00:00-04:00` | `America/New_York` |
| 4 | Fast Forward Philly | `2026-09-12T21:00:00-04:00` | `2026-09-13T02:00:00-04:00` | `America/New_York` |
| 5 | Night Shift: All Vinyl | `2026-09-18T23:00:00-04:00` | `2026-09-19T05:00:00-04:00` | `America/New_York` |
| 6 | Afterjinx After Hours | `2026-12-26T01:00:00-05:00` | `2026-12-26T03:00:00-05:00` | `America/New_York` |

The utility validates that both timestamps are finite instants, `endsAt` is later than
`startsAt`, and `timeZone` is accepted by `Intl.DateTimeFormat`. All listing labels,
event-detail labels, ticket date/time fields, filter comparisons, and calendar output
derive from these fields. No second human-readable date property remains in fixture data.

Formatting preserves the current compact style:

- Full range: `FRI SEP 04 · 10PM–4AM`
- Ticket day: `FRI SEP 04`
- Ticket doors/range: `10PM–4AM`

Cross-midnight end instants remain on the following calendar day even though the compact
range omits the repeated date. The canonical timestamps, not the label, control calendar
output and filtering.

## Event Utility API

`globalThis.NonsenseEventTools` exposes these focused functions:

```js
{
  validateEvent(event),
  formatEventDate(event),
  matchesEvent(event, criteria),
  filterEvents(events, criteria),
  buildCalendar(event, options),
  calendarFilename(event)
}
```

`formatEventDate(event)` returns `{ full, day, time }`. `criteria` contains
`query`, `genre`, `dateRange`, and `now`; passing `now` makes date tests deterministic.
`buildCalendar(event, { generatedAt })` likewise accepts an explicit generation instant
for deterministic tests and defaults to the current time in production.

The module contains no DOM access, fetch, package dependency, or application state.
Creating and clicking a download link remains the canvas adapter's responsibility.

## Search and Date Filtering

The component adds `query` and `dateRange` to its state while retaining the existing
`filter` genre state. Each static card receives `data-show-id`; its displayed date node
receives `data-show-date`. During the imperative render pass, the component looks up the
canonical event by ID, derives the date label, and applies visibility. Static card date
strings are removed so they cannot drift from fixture data.

Search normalization trims leading/trailing whitespace, collapses internal whitespace,
and compares case-insensitively. The query is split into whitespace-delimited tokens; all
tokens must occur somewhere in the combined title, venue, genre, and lineup search text.
This allows a query such as `void berlin` without requiring the characters to be adjacent.

The three filter dimensions combine with AND semantics:

- `all`: no date restriction.
- `next7`: `startsAt >= now` and `startsAt < now + 7 × 24 hours`.
- `next30`: `startsAt >= now` and `startsAt < now + 30 × 24 hours`.
- `later`: `startsAt >= now + 30 × 24 hours`.

The exact 30-day boundary belongs to Later; the exact 7-day boundary belongs to Next 30
but not Next 7. Cards stay in canonical chronological order.

The controls are:

1. A visibly labeled search input with an appropriate search type and autocomplete off.
2. A date-filter group with All dates, Next 7 days, Next 30 days, and Later chips.
3. The existing genre group.
4. A visible result count adjacent to the controls.

Date and genre chips are buttons with `aria-pressed`. Results update immediately; search
announcements are debounced briefly so screen readers do not announce every intermediate
keystroke. The existing polite filter status reports the combined result and criteria.

When no events match, the grid is hidden and a visible zero-state names the active
criteria and provides Clear filters. Clear filters restores an empty query, All dates,
and All genres, then returns focus to the search input.

## Calendar Download

The event detail's existing utility card gains an Add to calendar button. It is available
before purchase and for sold-out events. It always operates on the currently selected
event.

`buildCalendar` returns UTF-8 RFC 5545 text with CRLF line endings and this structure:

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Nonsense Tickets//Event Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-TIMEZONE:America/New_York
BEGIN:VEVENT
UID:<event-slug>-<UTC-start>@nonsense.tickets
DTSTAMP:<UTC-generation-time>
DTSTART:<UTC-start>
DTEND:<UTC-end>
SUMMARY:<event title>
LOCATION:<public venue string>
DESCRIPTION:<public note and lineup>
END:VEVENT
END:VCALENDAR
```

Backslashes, commas, semicolons, and newlines are escaped. Every content line is folded
at no more than 75 UTF-8 octets with RFC continuation whitespace. UTC event timestamps
avoid shipping a hand-maintained `VTIMEZONE` block while retaining exact instants across
cross-midnight events and daylight-saving offsets.

The deterministic UID combines a slug, UTC start stamp, and `@nonsense.tickets` domain.
The filename is `<event-slug>-YYYY-MM-DD.ics`, using the event's Philadelphia calendar
date. No `URL` is emitted because the static prototype has no stable routable event URL.

The canvas creates a `Blob` with `text/calendar;charset=utf-8`, clicks a temporary
download anchor, removes the anchor, and revokes the object URL. A dedicated polite status
region announces a successful file download. Exceptions are caught, leave the page
operational, and announce that the calendar download is unavailable.

## Error Handling

- Invalid internal fixture dates fail unit tests and are rejected by `validateEvent`.
- Filter operations treat a malformed event as non-matching rather than crashing the
  entire result set.
- Calendar generation throws a descriptive error for an invalid selected event. The UI
  catches it and announces failure without changing navigation or purchase state.
- An empty or whitespace-only query behaves exactly like no query.
- Browser download cleanup runs after both success and caught failure paths where an
  object URL was created.

## Files and Responsibilities

- Create `src/event-tools.js`: pure normalization, validation, formatting, matching,
  filtering, ICS serialization, escaping, line folding, UID, and filename functions.
- Modify `src/nonsense-tickets.dc.html`: synchronous utility script tag; normalized
  fixtures; layered controls; card IDs/date targets; zero state; calendar action; state,
  event handlers, derived labels, and announcements.
- Create `tests/event-tools.test.mjs`: dependency-free Node unit tests for the shared
  utility.
- Modify `package.json`: add `"test": "node --test"`; retain the existing dev command.
- Modify `README.md`: document the normalized model, calendar/search behavior, and test
  command.
- Modify `ROADMAP.md`: mark items 3 and 4 complete while preserving strict-CSP and backend
  blockers.
- Modify `.gitignore`: ignore `.superpowers/` visual-companion working files.
- Do not modify `src/support.js`, `src/image-slot.js`, assets, or vendored runtime files.

## Verification

Node tests cover:

- All six fixture instants and chronological order.
- Philadelphia full/day/time formatting, including cross-midnight events and the December
  standard-time offset.
- Query normalization, multi-token matching, each searchable field, genre matching, and
  combined AND behavior.
- Every date range plus exact 7-day and 30-day boundaries using a fixed `now`.
- Empty results and all-default reset criteria.
- UTC calendar conversion, stable UID and filename, public-only location, description
  escaping, CRLF output, UTF-8 75-octet folding, and malformed-event rejection.

Real-browser verification uses a fixed clock and covers:

- Six initial cards in chronological order.
- Search by artist and venue; genre filtering; every date range; combined filters; live
  result announcements; zero state; and reset focus.
- Keyboard operation and `aria-pressed` state.
- Desktop and narrow/mobile layouts.
- An intercepted `.ics` download whose parsed fields match the selected event.
- The existing Site → Event → detail → pay → issued regression flow.
- No new external network dependency.

Structural validation confirms:

- The `<script type="text/x-dc">` block and `src/event-tools.js` pass `node --check`.
- `src/support.js` and `src/image-slot.js` are unchanged.
- Existing `lang="en"`, live regions, picture elements, PNG/WebP assets, and balanced
  `sc-if` tags remain intact, with one deliberate additional calendar live region.
- Required local HTTP endpoints return 200.
- `git diff --check` passes and the final worktree is clean.

## Non-Goals

- No backend, persistence, event API, promoter editor, or real event routing.
- No direct Google/Apple calendar API integration.
- No modification to Apple Wallet behavior.
- No fee, pricing, checkout, ticket issuance, event-title, lineup, or venue changes.
- No correction of the Afterjinx promotional artwork; only the fixture's canonical demo
  date and derived visible date label change.
- No strict-CSP runtime work, generated runtime edits, Babel addition, framework migration,
  deployment, remote, branch, or push.

## Acceptance Criteria

The tranche is complete when:

1. Every event has one valid normalized start/end/time-zone model, and every visible event
   date derives from it.
2. Search, genre, and quick-date filters combine correctly, remain keyboard accessible,
   announce results, and provide a usable zero state/reset.
3. Every selected event can download a valid, privacy-preserving `.ics` file from its
   normalized metadata without a network request.
4. Unit and real-browser verification pass, including the existing purchase regression.
5. ROADMAP.md records items 3 and 4 as complete without claiming strict-CSP or backend
   progress.
6. Generated artifacts and all explicitly preserved behavior remain unchanged.

# Calendar, Search, and Date Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all six shows one normalized temporal model, add combined text/genre/date discovery controls, and generate a privacy-preserving `.ics` download for the selected event.

**Architecture:** A dependency-free classic script exposes pure event functions through `globalThis.NonsenseEventTools`; the existing canvas component remains a thin DOM/state adapter. Node's built-in test runner verifies temporal, filter, and RFC 5545 behavior, while real-browser checks cover the rendered controls, download, accessibility state, responsive layout, and purchase regression.

**Tech Stack:** JavaScript, Claude Design `DCLogic`, browser `Intl`/`Blob` APIs, Node 18+ `node:test`, Playwright CLI, static Node dev server.

---

### Task 1: Shared event utility contract

**Files:**
- Create: `tests/event-tools.test.mjs`
- Create: `src/event-tools.js`
- Modify: `package.json`

- [ ] **Step 1: Add the test command and write failing utility tests**

Add `"test": "node --test"` beside the existing `dev` script. Create the test file with
six normalized fixtures and assertions for the public API:

```js
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

let tools;
before(async () => {
  await import('../src/event-tools.js');
  tools = globalThis.NonsenseEventTools;
});

const concrete = {
  title: 'Concrete Mass 014',
  venue: 'Callowhill warehouse · address on ticket',
  genre: 'techno',
  lineup: ['VOID CADET (Berlin)', 'Slag Density'],
  note: '21+ · BYO earplugs · no photos on the floor',
  startsAt: '2026-09-04T22:00:00-04:00',
  endsAt: '2026-09-05T04:00:00-04:00',
  timeZone: 'America/New_York'
};

describe('formatEventDate', () => {
  test('formats the canonical cross-midnight range', () => {
    assert.deepEqual(tools.formatEventDate(concrete), {
      full: 'FRI SEP 04 · 10PM–4AM',
      day: 'FRI SEP 04',
      time: '10PM–4AM'
    });
  });
});

describe('matchesEvent', () => {
  test('matches normalized multi-token artist text', () => {
    assert.equal(tools.matchesEvent(concrete, {
      query: 'void berlin', genre: 'techno', dateRange: 'next30',
      now: '2026-08-24T12:00:00-04:00'
    }), true);
  });
  test('combines query, genre, and date range with AND semantics', () => {
    assert.equal(tools.matchesEvent(concrete, {
      query: 'void', genre: 'house', dateRange: 'next30',
      now: '2026-08-24T12:00:00-04:00'
    }), false);
  });
});

describe('buildCalendar', () => {
  test('serializes UTC instants and public metadata with CRLF', () => {
    const calendar = tools.buildCalendar(concrete, {
      generatedAt: '2026-08-24T16:00:00Z'
    });
    assert.match(calendar, /DTSTART:20260905T020000Z\r\n/);
    assert.match(calendar, /DTEND:20260905T080000Z\r\n/);
    assert.match(calendar, /LOCATION:Callowhill warehouse · address on ticket\r\n/);
    assert.equal(calendar.endsWith('\r\n'), true);
    assert.equal(tools.calendarFilename(concrete), 'concrete-mass-014-2026-09-04.ics');
  });
});
```

Extend this file before implementation with the remaining design-spec cases: all six
fixture dates, malformed instants, end-before-start, every searchable field, whitespace
and case normalization, exact 7/30-day boundaries, stable UID, escaping, Unicode line
folding, filename date, and input-order preservation in `filterEvents`.

- [ ] **Step 2: Run the tests to prove the utility is missing**

Run: `npm test`

Expected: FAIL because `src/event-tools.js` cannot be imported or
`globalThis.NonsenseEventTools` is undefined.

- [ ] **Step 3: Implement the minimal complete utility**

Create a strict IIFE in `src/event-tools.js` that assigns this exact frozen API:

```js
(function exposeEventTools(root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const encoder = new TextEncoder();

  function parseInstant(value, name) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError(name + ' must be a valid timestamp.');
    return date;
  }

  function validateEvent(event) {
    if (!event || typeof event !== 'object') throw new TypeError('Event must be an object.');
    const start = parseInstant(event.startsAt, 'startsAt');
    const end = parseInstant(event.endsAt, 'endsAt');
    if (end <= start) throw new RangeError('endsAt must be later than startsAt.');
    try {
      new Intl.DateTimeFormat('en-US', {timeZone:event.timeZone}).format(start);
    } catch {
      throw new RangeError('timeZone must be a valid IANA time zone.');
    }
    return {start, end, timeZone:event.timeZone};
  }

  function parts(date, timeZone, options) {
    const values = {};
    new Intl.DateTimeFormat('en-US', {timeZone, ...options}).formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') values[part.type] = part.value;
    });
    return values;
  }

  function dayLabel(date, timeZone) {
    const value = parts(date, timeZone, {weekday:'short', month:'short', day:'2-digit'});
    return (value.weekday + ' ' + value.month + ' ' + value.day).toUpperCase();
  }

  function timeLabel(date, timeZone) {
    const value = parts(date, timeZone, {hour:'numeric', minute:'2-digit', hour12:true});
    return value.hour + (value.minute === '00' ? '' : ':' + value.minute) + value.dayPeriod.toUpperCase();
  }

  function formatEventDate(event) {
    const {start, end, timeZone} = validateEvent(event);
    const day = dayLabel(start, timeZone);
    const time = timeLabel(start, timeZone) + '–' + timeLabel(end, timeZone);
    return {full:day + ' · ' + time, day, time};
  }

  function normalize(value) {
    return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ');
  }

  function matchesEvent(event, criteria = {}) {
    let validated;
    try { validated = validateEvent(event); } catch { return false; }
    const query = normalize(criteria.query);
    const tokens = query ? query.split(' ') : [];
    const haystack = normalize([event.title, event.venue, event.genre, ...(event.lineup || [])].join(' '));
    if (!tokens.every((token) => haystack.includes(token))) return false;
    const genre = normalize(criteria.genre || 'all');
    if (genre !== 'all' && normalize(event.genre) !== genre) return false;
    const dateRange = criteria.dateRange || 'all';
    if (dateRange === 'all') return true;
    const now = criteria.now == null ? Date.now() : new Date(criteria.now).getTime();
    if (!Number.isFinite(now)) return false;
    const delta = validated.start.getTime() - now;
    if (dateRange === 'next7') return delta >= 0 && delta < 7 * DAY_MS;
    if (dateRange === 'next30') return delta >= 0 && delta < 30 * DAY_MS;
    if (dateRange === 'later') return delta >= 30 * DAY_MS;
    return false;
  }

  function filterEvents(events, criteria = {}) {
    if (!Array.isArray(events)) throw new TypeError('events must be an array.');
    return events.filter((event) => matchesEvent(event, criteria));
  }

  function slug(value) {
    return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  }

  function utcStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function localDateStamp(date, timeZone) {
    const value = parts(date, timeZone, {year:'numeric', month:'2-digit', day:'2-digit'});
    return value.year + '-' + value.month + '-' + value.day;
  }

  function escapeText(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;').replace(/,/g, '\\,');
  }

  function foldLine(line) {
    const segments = [];
    let current = '';
    let limit = 75;
    for (const character of line) {
      if (current && encoder.encode(current + character).length > limit) {
        segments.push(current);
        current = character;
        limit = 74;
      } else {
        current += character;
      }
    }
    segments.push(current);
    return segments.map((segment, index) => (index ? ' ' : '') + segment).join('\r\n');
  }

  function buildCalendar(event, options = {}) {
    const {start, end, timeZone} = validateEvent(event);
    const generatedAt = parseInstant(options.generatedAt ?? new Date(), 'generatedAt');
    const description = [event.note, event.lineup?.length ? 'Lineup: ' + event.lineup.join(', ') : '']
      .filter(Boolean).join('\n');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'PRODID:-//Nonsense Tickets//Event Calendar//EN', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', 'X-WR-TIMEZONE:' + timeZone, 'BEGIN:VEVENT',
      'UID:' + slug(event.title) + '-' + utcStamp(start) + '@nonsense.tickets',
      'DTSTAMP:' + utcStamp(generatedAt), 'DTSTART:' + utcStamp(start),
      'DTEND:' + utcStamp(end), 'SUMMARY:' + escapeText(event.title),
      'LOCATION:' + escapeText(event.venue), 'DESCRIPTION:' + escapeText(description),
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  function calendarFilename(event) {
    const {start, timeZone} = validateEvent(event);
    return slug(event.title) + '-' + localDateStamp(start, timeZone) + '.ics';
  }

  root.NonsenseEventTools = Object.freeze({
    validateEvent,
    formatEventDate,
    matchesEvent,
    filterEvents,
    buildCalendar,
    calendarFilename
  });
})(globalThis);
```

Implement every behavior enumerated by the tests and approved design. `matchesEvent`
returns false for an invalid event; formatting and calendar generation throw descriptive
`TypeError`/`RangeError` instances. Fold physical lines to at most 75 UTF-8 octets,
including the continuation space.

- [ ] **Step 4: Run utility and syntax tests**

Run:

```bash
npm test
node --check src/event-tools.js
```

Expected: all tests PASS and syntax check exits 0.

- [ ] **Step 5: Commit the utility**

```bash
git add package.json src/event-tools.js tests/event-tools.test.mjs
git commit -m "feat: add normalized event utilities"
```

### Task 2: Canonical fixture dates and derived display labels

**Files:**
- Modify: `src/nonsense-tickets.dc.html`
- Modify: `tests/event-tools.test.mjs`

- [ ] **Step 1: Add a failing fixture/source consistency test**

Read the canvas source in the test and assert that it contains all six `startsAt`,
`endsAt`, and `timeZone` triples; contains no fixture `date:` property; has six
`data-show-id` and six `data-show-date` attributes; and loads `./event-tools.js` before
`./support.js`.

- [ ] **Step 2: Run the test and verify the old display-only model fails**

Run: `npm test`

Expected: FAIL on the missing normalized fixture fields and utility script tag.

- [ ] **Step 3: Normalize all six fixtures and connect every date surface**

Add `<script src="./event-tools.js"></script>` synchronously after ReactDOM and before
`support.js`. Replace every fixture `date` property with the exact timestamps in the
approved design. Add `data-show-id` to cards and `data-show-date` to listing date nodes,
removing their duplicated date text.

Replace the `s.date.split('·')` getter logic with:

```js
const formatted = s
  ? globalThis.NonsenseEventTools.formatEventDate(s)
  : {full:'', day:'', time:''};
```

Return `formatted.full`, `formatted.day`, and `formatted.time` as `selDate`, `selDay`, and
`selTime`. In `apply()`, populate every `[data-show-date]` from its event ID.

- [ ] **Step 4: Run tests and canvas syntax validation**

Run `npm test`, extract the `text/x-dc` block, and pipe it to `node --check -`.

Expected: all tests PASS; the six formatted labels include `SAT DEC 26 · 1AM–3AM`.

- [ ] **Step 5: Commit normalized fixture dates**

```bash
git add src/nonsense-tickets.dc.html tests/event-tools.test.mjs
git commit -m "feat: normalize event dates"
```

### Task 3: Combined search, date, and genre filtering

**Files:**
- Modify: `src/nonsense-tickets.dc.html`
- Modify: `tests/event-tools.test.mjs`

- [ ] **Step 1: Add failing source-contract and criteria tests**

Assert the canvas contains a labeled `type="search"` control, four date chips, six show
IDs, a visible result-count target, a zero-state target, and Clear filters. Add utility
assertions proving query/genre/date criteria return the correct IDs for a fixed
`2026-08-24T12:00:00-04:00` clock.

- [ ] **Step 2: Run tests to prove the discovery UI is absent**

Run: `npm test`

Expected: FAIL on the missing search/date/zero-state source contract.

- [ ] **Step 3: Add the layered controls and state transitions**

Add `query:''` and `dateRange:'all'` to component state. Insert a visible search label and
input, the four date-chip buttons, result count, and zero state above/below the existing
grid. Keep genre chips as the third control layer.

Add click handling for `datefilter` and `clearfilters`, input handling for
`[data-show-search]`, a 180 ms announcement debounce, and cleanup of its timer. Clear
filters resets all three dimensions and focuses the search input.

Add component helpers that produce the criteria object, visible ID set, and accessible
criteria summary. Update `apply()` to:

- Set `aria-pressed` plus selected styles on date and genre chips.
- Show only matching `[data-show-id]` cards.
- Update the visible result count.
- Toggle the zero state and grid.
- Keep every displayed card date derived from event metadata.

Update `announceFilter()` to report the combined count and criteria.

- [ ] **Step 4: Run unit, syntax, and real-browser filter checks**

Run `npm test` and `node --check` on the extracted canvas script. With a fixed browser
clock, verify six defaults, artist search, venue search, genre, Next 7, Next 30, Later,
combined filters, zero state, Clear filters focus, `aria-pressed`, and the polite status.

Expected: all assertions PASS without console exceptions.

- [ ] **Step 5: Commit discovery controls**

```bash
git add src/nonsense-tickets.dc.html tests/event-tools.test.mjs
git commit -m "feat: add show search and date filters"
```

### Task 4: Calendar download integration

**Files:**
- Modify: `src/nonsense-tickets.dc.html`
- Modify: `tests/event-tools.test.mjs`

- [ ] **Step 1: Add failing calendar UI contract tests**

Assert the canvas has a dedicated polite calendar status region and an
`data-action="calendar"` button in the event utility card. Keep the calendar serialization
tests from Task 1 as the content contract.

- [ ] **Step 2: Run tests and verify the calendar action is absent**

Run: `npm test`

Expected: FAIL on the missing calendar status/action source contract.

- [ ] **Step 3: Implement download behavior in the canvas adapter**

Add `downloadCalendar()` to serialize `this.sel()`, create a calendar `Blob`, create and
click a hidden anchor using `calendarFilename`, remove it, and revoke the object URL.
Announce exact success or failure through the dedicated region. Add the `calendar` branch
to delegated click handling without changing purchase or wallet branches.

- [ ] **Step 4: Verify a real downloaded file**

Start the existing dev server. In a browser, open Concrete Mass 014, intercept the
download, click Add to calendar, and assert filename, MIME-compatible content, UTC start
and end, title, public venue, CRLF endings, and absence of any inferred street address.
Repeat the date assertions for Afterjinx. Re-run Site → Event → detail → pay → issued.

Expected: downloads match the selected event; purchase regression remains green.

- [ ] **Step 5: Commit calendar integration**

```bash
git add src/nonsense-tickets.dc.html tests/event-tools.test.mjs
git commit -m "feat: add event calendar downloads"
```

### Task 5: Documentation and completion audit

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update authoritative documentation**

Document `npm test`, `src/event-tools.js`, the canonical `startsAt`/`endsAt`/`timeZone`
model, combined filters, local `.ics` generation, and public-location rule in README.md.
Mark ROADMAP.md items 3 and 4 Complete (scoped), remove their prior blockers, and retain
the strict-CSP and backend blockers unchanged.

- [ ] **Step 2: Run the complete automated validation suite**

Run:

```bash
npm test
node --check src/event-tools.js
git diff --check
```

Extract the `text/x-dc` block and pass it to `node --check -`. Confirm expected counts:
six normalized events/cards, four date chips, seven pictures, eight PNGs, eight WebPs,
balanced `sc-if` 10/10, existing two live regions plus one calendar region, and the local
runtime order.

- [ ] **Step 3: Run final HTTP and browser verification**

Confirm HTTP 200 for `/`, `/nonsense-tickets.dc.html`, `/event-tools.js`, both local React
files, and a WebP asset. With unpkg blocked and a fixed clock, repeat the complete discovery,
calendar download, responsive, keyboard/accessibility, and purchase regression matrix.

- [ ] **Step 4: Prove protected scope and review the diff**

Confirm `src/support.js`, `src/image-slot.js`, all vendor files, all assets, fees, prices,
and purchase logic are unchanged. Inspect every changed path and run `git diff --check`.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md ROADMAP.md
git commit -m "docs: complete calendar and discovery roadmap items"
```

- [ ] **Step 6: Confirm final repository state**

Run `git status --short --branch` and `git log --oneline -6`.

Expected: clean `master`, no remote or push, and all tranche commits present after the
approved design and implementation-plan commits.

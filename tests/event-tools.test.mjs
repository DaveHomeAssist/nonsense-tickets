import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

const utilityPath = new URL('../src/event-tools.js', import.meta.url);
let utilityPromise;

async function loadTools() {
  if (!utilityPromise) {
    utilityPromise = (async () => {
      assert.equal(existsSync(utilityPath), true, 'src/event-tools.js should exist');
      await import(utilityPath.href);
      assert.ok(globalThis.NonsenseEventTools, 'NonsenseEventTools should be exposed');
      return globalThis.NonsenseEventTools;
    })();
  }
  return utilityPromise;
}

const catalogPath = new URL('../src/event-catalog.js', import.meta.url);
const canvasPath = new URL('../src/nonsense-tickets.dc.html', import.meta.url);

/* The fixtures are the catalog the site ships, not a second copy of it. */
await loadTools();
await import(catalogPath.href);
const catalog = globalThis.NonsenseEventCatalog.events;
const shows = ['1', '2', '3', '4', '5', '6'].map((id) => ({id, ...catalog[id]}));
const afterbreak = {id: '7', ...catalog['7']};

describe('NonsenseEventTools API', () => {
  test('exposes one frozen dependency-free utility surface', async () => {
    const tools = await loadTools();
    assert.equal(Object.isFrozen(tools), true);
    assert.deepEqual(Object.keys(tools).sort(), [
      'buildCalendar', 'calendarFilename', 'filterEvents', 'formatEventDate', 'matchesEvent', 'validateEvent'
    ]);
  });
});

describe('canonical date validation and formatting', () => {
  test('formats all six Philadelphia fixture ranges', async () => {
    const tools = await loadTools();
    assert.deepEqual(shows.map((show) => tools.formatEventDate(show).full), [
      'FRI SEP 04 · 10PM–4AM',
      'SAT SEP 05 · 9PM–2AM',
      'FRI SEP 11 · 10PM–3AM',
      'SAT SEP 12 · 9PM–2AM',
      'FRI SEP 18 · 11PM–5AM',
      'SAT DEC 26 · 1AM–3AM'
    ]);
    assert.deepEqual(tools.formatEventDate(shows[0]), {
      full: 'FRI SEP 04 · 10PM–4AM', day: 'FRI SEP 04', time: '10PM–4AM'
    });
  });

  test('rejects malformed instants, reversed ranges, and invalid zones', async () => {
    const tools = await loadTools();
    assert.throws(() => tools.validateEvent({...shows[0], startsAt: 'nope'}), /startsAt/);
    assert.throws(() => tools.validateEvent({...shows[0], endsAt: shows[0].startsAt}), /later/);
    assert.throws(() => tools.validateEvent({...shows[0], timeZone: 'Philadelphia'}), /timeZone/);
  });

  test('validates and formats a two-session event without inventing session end times', async () => {
    const tools = await loadTools();
    const validated = tools.validateEvent(afterbreak);
    assert.deepEqual(validated.sessions.map((session) => session.id), ['night-1', 'night-2']);
    assert.deepEqual(validated.offers.map((offer) => offer.id), [
      'night-1-early-bird', 'night-2-early-bird', 'combo-early-bird'
    ]);
    assert.deepEqual(tools.formatEventDate(afterbreak), {
      full: '2 NIGHTS · FRI SEP 11 + SAT SEP 12 · 11:45PM EACH NIGHT',
      day: 'FRI SEP 11 + SAT SEP 12',
      time: '11:45PM EACH NIGHT'
    });
    assert.equal(tools.matchesEvent(afterbreak, {query: 'night combo'}), true);
  });

  test('rejects invalid session, offer, and external checkout contracts', async () => {
    const tools = await loadTools();
    assert.throws(() => tools.validateEvent({
      ...afterbreak,
      sessions: [...afterbreak.sessions, {...afterbreak.sessions[0]}]
    }), /session IDs must be unique/);
    assert.throws(() => tools.validateEvent({
      ...afterbreak,
      offers: [{...afterbreak.offers[0], sessionIds: ['night-3']}]
    }), /unknown session/);
    assert.throws(() => tools.validateEvent({
      ...afterbreak,
      offers: [{...afterbreak.offers[0], facePrice: -1}]
    }), /facePrice/);
    assert.throws(() => tools.validateEvent({
      ...afterbreak,
      checkout: {...afterbreak.checkout, url: 'http://linkstub.com/en/ab26'}
    }), /HTTPS/);
  });
});

describe('search and filter matching', () => {
  test('matches title, public venue, genre, and lineup case-insensitively', async () => {
    const tools = await loadTools();
    assert.equal(tools.matchesEvent(shows[4], {query: '  NIGHT   vinyl  '}), true);
    assert.equal(tools.matchesEvent(shows[2], {query: 'kensington'}), true);
    assert.equal(tools.matchesEvent(shows[3], {query: 'DNB'}), true);
    assert.equal(tools.matchesEvent(shows[0], {query: 'void berlin'}), true);
    assert.equal(tools.matchesEvent(shows[0], {query: 'void london'}), false);
  });

  test('combines query, genre, and rolling date ranges with AND semantics', async () => {
    const tools = await loadTools();
    const now = '2026-08-24T12:00:00-04:00';
    assert.equal(tools.matchesEvent(shows[0], {query: 'void', genre: 'techno', dateRange: 'next30', now}), true);
    assert.equal(tools.matchesEvent(shows[0], {query: 'void', genre: 'house', dateRange: 'next30', now}), false);
    assert.equal(tools.matchesEvent(shows[5], {genre: 'bass', dateRange: 'later', now}), true);
    assert.equal(tools.matchesEvent(shows[5], {genre: 'bass', dateRange: 'next30', now}), false);
  });

  test('assigns exact seven-day and thirty-day boundaries deterministically', async () => {
    const tools = await loadTools();
    const now = '2026-01-01T00:00:00Z';
    const atSeven = {...shows[0], startsAt: '2026-01-08T00:00:00Z', endsAt: '2026-01-08T01:00:00Z', timeZone: 'UTC'};
    const atThirty = {...shows[0], startsAt: '2026-01-31T00:00:00Z', endsAt: '2026-01-31T01:00:00Z', timeZone: 'UTC'};
    assert.equal(tools.matchesEvent(atSeven, {dateRange: 'next7', now}), false);
    assert.equal(tools.matchesEvent(atSeven, {dateRange: 'next30', now}), true);
    assert.equal(tools.matchesEvent(atThirty, {dateRange: 'next30', now}), false);
    assert.equal(tools.matchesEvent(atThirty, {dateRange: 'later', now}), true);
  });

  test('preserves input order and excludes malformed events', async () => {
    const tools = await loadTools();
    const result = tools.filterEvents([shows[2], {...shows[0], startsAt: 'bad'}, shows[0]], {genre: 'all'});
    assert.deepEqual(result.map((show) => show.id), ['3', '1']);
  });

  test('returns the expected fixture IDs for quick ranges and combined discovery', async () => {
    const tools = await loadTools();
    const now = '2026-08-24T12:00:00-04:00';
    assert.deepEqual(tools.filterEvents(shows, {dateRange:'next7', now}).map((show) => show.id), []);
    assert.deepEqual(tools.filterEvents(shows, {dateRange:'next30', now}).map((show) => show.id), ['1', '2', '3', '4', '5']);
    assert.deepEqual(tools.filterEvents(shows, {dateRange:'later', now}).map((show) => show.id), ['6']);
    assert.deepEqual(tools.filterEvents(shows, {
      query:'vinyl west', genre:'techno', dateRange:'next30', now
    }).map((show) => show.id), ['5']);
  });
});

describe('RFC 5545 calendar serialization', () => {
  test('serializes stable UTC fields and public-only metadata', async () => {
    const tools = await loadTools();
    const calendar = tools.buildCalendar(shows[0], {generatedAt: '2026-08-24T16:00:00Z'});
    assert.match(calendar, /UID:concrete-mass-014-20260905T020000Z@nonsense\.tickets\r\n/);
    assert.match(calendar, /DTSTAMP:20260824T160000Z\r\n/);
    assert.match(calendar, /DTSTART:20260905T020000Z\r\n/);
    assert.match(calendar, /DTEND:20260905T080000Z\r\n/);
    assert.match(calendar, /LOCATION:Callowhill warehouse · address on ticket\r\n/);
    assert.doesNotMatch(calendar, /1213 N Front/);
    assert.equal(calendar.endsWith('\r\n'), true);
    assert.equal(calendar.replaceAll('\r\n', '').includes('\n'), false);
    assert.equal(tools.calendarFilename(shows[0]), 'concrete-mass-014-2026-09-04.ics');
  });

  test('converts the December standard-time fixture correctly', async () => {
    const tools = await loadTools();
    const calendar = tools.buildCalendar(shows[5], {generatedAt: '2026-08-24T16:00:00Z'});
    assert.match(calendar, /DTSTART:20261226T060000Z\r\n/);
    assert.match(calendar, /DTEND:20261226T080000Z\r\n/);
    assert.equal(tools.calendarFilename(shows[5]), 'afterjinx-after-hours-2026-12-26.ics');
  });

  test('escapes content and folds every UTF-8 physical line to 75 octets', async () => {
    const tools = await loadTools();
    const event = {
      ...shows[0],
      title: `Béton, Bass; ${'é'.repeat(60)}`,
      venue: 'Room \\ One, Philadelphia; PA',
      note: 'First line\nSecond line'
    };
    const calendar = tools.buildCalendar(event, {generatedAt: '2026-08-24T16:00:00Z'});
    assert.match(calendar, /LOCATION:Room \\\\ One\\, Philadelphia\\; PA/);
    assert.match(calendar, /DESCRIPTION:First line\\nSecond line\\nLineup:/);
    for (const line of calendar.split('\r\n').filter(Boolean)) {
      assert.ok(new TextEncoder().encode(line).length <= 75, `line exceeds 75 octets: ${line}`);
    }
    assert.match(calendar, /\r\n /, 'long content should use continuation lines');
  });

  test('refuses a misleading calendar when session end times are unpublished', async () => {
    const tools = await loadTools();
    assert.throws(() => tools.buildCalendar(afterbreak), /exact session end time/);
  });
});

describe('canvas normalized event source contract', () => {
  test('loads event tools and the catalog synchronously before the generated runtime', async () => {
    const canvas = await readFile(canvasPath, 'utf8');
    const toolsIndex = canvas.indexOf('<script src="./event-tools.js"></script>');
    const catalogIndex = canvas.indexOf('<script src="./event-catalog.js"></script>');
    const supportIndex = canvas.indexOf('<script src="./support.js"></script>');
    assert.ok(toolsIndex >= 0, 'event-tools.js script tag should exist');
    assert.ok(catalogIndex > toolsIndex, 'event-catalog.js should load after event-tools.js');
    assert.ok(catalogIndex < supportIndex, 'event-catalog.js should load before support.js');
  });

  test('defines seven canonical event ranges plus two canonical session starts in the catalog only', async () => {
    const source = await readFile(catalogPath, 'utf8');
    const canvas = await readFile(canvasPath, 'utf8');
    assert.equal((source.match(/\bstartsAt:/g) || []).length, 9);
    assert.equal((source.match(/\bendsAt:/g) || []).length, 7);
    assert.equal((source.match(/\btimeZone:/g) || []).length, 7);
    assert.equal(/\bdate:'(?:FRI|SAT)/.test(source), false);
    for (const show of shows) {
      assert.match(source, new RegExp(`startsAt:'${show.startsAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
      assert.match(source, new RegExp(`endsAt:'${show.endsAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    }
    /* The canvas must not carry a second copy of any event definition. */
    assert.equal((canvas.match(/\bstartsAt:/g) || []).length, 0);
    assert.equal((canvas.match(/\bendsAt:/g) || []).length, 0);
    assert.match(canvas, /data = globalThis\.NonsenseEventCatalog\.events;/);
  });

  test('connects all seven cards to canonical event IDs and derived date targets', async () => {
    const canvas = await readFile(new URL('../src/nonsense-tickets.dc.html', import.meta.url), 'utf8');
    assert.equal((canvas.match(/data-show-id="[1-7]"/g) || []).length, 7);
    assert.equal((canvas.match(/data-show-date="[1-7]"/g) || []).length, 7);
    assert.match(canvas, /NonsenseEventTools\.formatEventDate\(s\)/);
  });

  test('models AfterBreak offers as external session entitlements without native issuance', async () => {
    const source = await readFile(catalogPath, 'utf8');
    const canvas = await readFile(canvasPath, 'utf8');
    assert.match(source, /7:\{[^\n]*title:'AfterBreak 2026'/);
    assert.equal((source.match(/id:'night-[12]'/g) || []).length, 2);
    assert.equal((source.match(/id:'(?:night-[12]|combo)-early-bird'/g) || []).length, 3);
    assert.match(source, /sessionIds:\['night-1','night-2'\]/);
    assert.match(source, /checkout:\{mode:'external',provider:'Linkstub',url:'https:\/\/linkstub\.com\/en\/ab26'\}/);
    assert.match(canvas, /data-external-offers[^>]*role="list"/);
    assert.match(canvas, /data-external-checkout-link[^>]*href="https:\/\/linkstub\.com\/en\/ab26"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.match(canvas, /aria-label="Choose AfterBreak tickets on Linkstub \(opens in a new tab\)"/);
    assert.match(canvas, /data-external-eyebrow[^>]*color:var\(--paper\)/);
    assert.match(canvas, /data-native-checkout/);
    assert.match(canvas, /data-external-checkout/);
  });

  test('defines accessible layered discovery controls and a resettable zero state', async () => {
    const canvas = await readFile(new URL('../src/nonsense-tickets.dc.html', import.meta.url), 'utf8');
    assert.match(canvas, /<label[^>]*for="showSearch"[^>]*>Search shows<\/label>/);
    assert.match(canvas, /<input[^>]*id="showSearch"[^>]*data-show-search[^>]*type="search"/);
    assert.equal((canvas.match(/data-date-chip="(?:all|next7|next30|later)"/g) || []).length, 4);
    assert.match(canvas, /data-results-count/);
    assert.match(canvas, /data-show-grid/);
    assert.match(canvas, /data-filter-empty/);
    assert.match(canvas, /data-action="clearfilters"/);
    assert.match(canvas, /query:'', dateRange:'all'/);
    assert.match(canvas, /NonsenseEventTools\.matchesEvent/);
  });

  test('offers an accessible calendar download from every event detail view', async () => {
    const canvas = await readFile(new URL('../src/nonsense-tickets.dc.html', import.meta.url), 'utf8');
    assert.match(canvas, /data-calendar-status[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(canvas, /data-action="calendar"/);
    assert.match(canvas, /downloadCalendar\(\)/);
    assert.match(canvas, /NonsenseEventTools\.buildCalendar/);
    assert.match(canvas, /NonsenseEventTools\.calendarFilename/);
  });

  test('links the promoter surface to the official No Nonsense destinations', async () => {
    const canvas = await readFile(new URL('../src/nonsense-tickets.dc.html', import.meta.url), 'utf8');
    assert.match(canvas, /href="https:\/\/linktr\.ee\/nononsensephl"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.match(canvas, /href="https:\/\/linkstub\.com\/en\/ab26"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.match(canvas, /aria-label="Open No Nonsense links in a new tab"/);
    assert.match(canvas, /aria-label="View AfterBreak 2026 tickets in a new tab"/);
  });
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

/* The catalog is the storefront's only source of truth for a show. This
   suite checks the real shipped entries against the event contract, rather
   than a copy of them, so a bad entry fails CI before it renders. */

const root = new URL('../', import.meta.url);

await import(new URL('src/event-tools.js', root).href);
await import(new URL('src/event-catalog.js', root).href);

const tools = globalThis.NonsenseEventTools;
const catalog = globalThis.NonsenseEventCatalog;

describe('event catalog registry', () => {
  test('exposes one frozen catalog with seven entries', () => {
    assert.ok(catalog, 'NonsenseEventCatalog should be exposed');
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(Object.isFrozen(catalog.events), true);
    assert.deepEqual(Object.keys(catalog.events), ['1', '2', '3', '4', '5', '6', '7']);
  });

  test('every shipped entry satisfies the event contract', () => {
    for (const [id, event] of Object.entries(catalog.events)) {
      assert.doesNotThrow(() => tools.validateEvent(event), 'catalog entry ' + id + ' must validate');
      assert.equal(typeof event.title, 'string', id + ' title');
      assert.ok(event.title.trim(), id + ' title must not be empty');
      assert.equal(typeof event.venue, 'string', id + ' venue');
      assert.equal(typeof event.genre, 'string', id + ' genre');
      assert.ok(Array.isArray(event.lineup) && event.lineup.length, id + ' lineup');
      assert.ok(Number.isInteger(event.price) && event.price >= 0, id + ' price must be a nonnegative whole dollar amount');
      assert.ok(catalog.TAGS.includes(event.tag), id + ' tag must be one of ' + catalog.TAGS.join(', '));
    }
  });

  test('external sale and native sale are mutually exclusive per entry', () => {
    for (const [id, event] of Object.entries(catalog.events)) {
      const external = !!(event.checkout && event.checkout.mode === 'external');
      assert.equal(external, event.tag === 'external', id + ' external checkout must carry the external tag');
      if (external) {
        assert.ok(Array.isArray(event.offers) && event.offers.length, id + ' external sale must publish its offers');
        assert.ok(Array.isArray(event.sessions) && event.sessions.length, id + ' offers must reference sessions');
      }
    }
  });

  test('every native fixture can export a calendar file', () => {
    for (const [id, event] of Object.entries(catalog.events)) {
      if (event.tag === 'external') continue;
      assert.doesNotThrow(() => tools.buildCalendar(event, {generatedAt: '2026-08-24T16:00:00Z'}), id + ' calendar');
    }
  });

  test('the canvas renders one card per catalog entry with no copied price or status', async () => {
    const canvas = await readFile(new URL('src/nonsense-tickets.dc.html', root), 'utf8');
    for (const id of Object.keys(catalog.events)) {
      assert.match(canvas, new RegExp('data-show-id="' + id + '"'), 'card for entry ' + id);
      assert.match(canvas, new RegExp('data-show-date="' + id + '"'), 'date target for entry ' + id);
      assert.match(canvas, new RegExp('data-show-price="' + id + '"'), 'price target for entry ' + id);
      assert.match(canvas, new RegExp('data-show-status="' + id + '"'), 'status target for entry ' + id);
    }
    assert.equal((canvas.match(/data-show-id="[1-7]"/g) || []).length, 7);
    /* A card must not carry its own face price or sale status text. */
    assert.doesNotMatch(canvas, /data-price="\d+"/);
    assert.doesNotMatch(canvas, /white-space:nowrap">(?:On sale|Low tix|Sold out|Official sale)<\/span>/);
    assert.doesNotMatch(canvas, /font-size:15px">From \$\d+/);
    assert.match(canvas, /this\.cardPrice\(event, fee\)/);
    assert.match(canvas, /this\.statusBadge\(event\)/);
  });
});

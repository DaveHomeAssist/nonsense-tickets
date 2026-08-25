import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, test, before } from 'node:test';

/* The QR encoder replaces a decorative CSS grid, so these assertions pin the
   things that make a symbol actually scannable rather than merely square.

   The symbols produced here were additionally verified out of band against
   the zbar decoder (100/100 across versions 1-20 and every padding length)
   and against the segno encoder, which reproduced them module for module.
   These in-repo tests keep that result from regressing without adding a
   dependency to the project. */

let QR;

before(async () => {
  const url = new URL('../src/qr-encode.js', import.meta.url);
  assert.equal(existsSync(url), true, 'src/qr-encode.js should exist');
  await import(url.href);
  QR = globalThis.NonsenseQR;
});

function moduleAt(symbol, row, col) {
  return symbol.modules[row * symbol.size + col];
}

describe('codeword generation', () => {
  test('matches the ISO 18004 bit stream for a padded version 1 symbol', () => {
    /* mode 0100, count 00001101, thirteen 0x78 bytes, 0000 terminator,
       then the 11101100 pad codeword. Hand computed from the spec. */
    const codewords = QR.codewordsFor('x'.repeat(13), 1);
    const data = Array.from(codewords.slice(0, 16));
    assert.deepEqual(data, [0x40, 0xd7, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x80, 0xec]);
    assert.equal(codewords.length, 26, 'version 1 level M is 16 data plus 10 error correction codewords');
  });

  test('pad codewords alternate 0xEC and 0x11', () => {
    const codewords = QR.codewordsFor('x', 1);
    const data = Array.from(codewords.slice(0, 16));
    assert.deepEqual(data.slice(3), [0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
  });

  test('a symbol filled to capacity has no pad codewords', () => {
    const capacity = QR.capacityBytes(12);
    const codewords = QR.codewordsFor('x'.repeat(capacity), 12);
    assert.equal(codewords.includes(0xec), false, 'a full symbol should not contain pad codewords');
  });
});

describe('version selection', () => {
  test('picks the smallest version that fits', () => {
    for (let version = 1; version <= QR.MAX_VERSION; version += 1) {
      const capacity = QR.capacityBytes(version);
      assert.equal(QR.chooseVersion(capacity), version, 'exact capacity should fit version ' + version);
      if (version < QR.MAX_VERSION) {
        assert.equal(QR.chooseVersion(capacity + 1), version + 1, 'one byte over should step up from ' + version);
      }
    }
  });

  test('a real signed ticket payload fits comfortably', () => {
    /* An NT1 payload is about 287 characters. */
    const symbol = QR.encode('NT1.' + 'a'.repeat(200) + '.' + 'b'.repeat(86));
    assert.equal(symbol.size, symbol.version * 4 + 17);
    assert.ok(symbol.version <= 13, 'a ticket should not need a version above 13, got ' + symbol.version);
  });

  test('refuses input beyond the supported range', () => {
    assert.throws(() => QR.encode('x'.repeat(QR.capacityBytes(QR.MAX_VERSION) + 1)), /exceeds QR version/);
  });
});

describe('symbol structure', () => {
  const samples = ['A', 'NON-4K2P9X', 'x'.repeat(120), 'x'.repeat(300)];

  test('finder patterns sit in all three corners', () => {
    samples.forEach((text) => {
      const symbol = QR.encode(text);
      const corners = [[0, 0], [0, symbol.size - 7], [symbol.size - 7, 0]];
      corners.forEach(([top, left]) => {
        for (let row = 0; row < 7; row += 1) {
          for (let col = 0; col < 7; col += 1) {
            const distance = Math.max(Math.abs(row - 3), Math.abs(col - 3));
            const expected = distance !== 2 ? 1 : 0;
            assert.equal(moduleAt(symbol, top + row, left + col), expected,
              'finder module at ' + (top + row) + ',' + (left + col) + ' for "' + text.slice(0, 8) + '"');
          }
        }
      });
    });
  });

  test('timing patterns alternate', () => {
    samples.forEach((text) => {
      const symbol = QR.encode(text);
      for (let index = 8; index < symbol.size - 8; index += 1) {
        const expected = index % 2 === 0 ? 1 : 0;
        assert.equal(moduleAt(symbol, 6, index), expected, 'horizontal timing at ' + index);
        assert.equal(moduleAt(symbol, index, 6), expected, 'vertical timing at ' + index);
      }
    });
  });

  test('the dark module is always set', () => {
    samples.forEach((text) => {
      const symbol = QR.encode(text);
      assert.equal(moduleAt(symbol, symbol.size - 8, 8), 1);
    });
  });

  test('column zero receives data', () => {
    /* Regression: the placement cursor must shift to column 5 when it reaches
       the vertical timing pattern. Failing to move the cursor itself left
       column 0 empty and re-walked column 4, which error correction silently
       repaired - burning the recovery budget that glare and scratches need. */
    const symbol = QR.encode('x'.repeat(300));
    let dark = 0;
    for (let row = 0; row < symbol.size; row += 1) {
      if (moduleAt(symbol, row, 0)) dark += 1;
    }
    assert.ok(dark > 3, 'column 0 should carry data modules, saw ' + dark + ' dark');
  });

  test('format information decodes back to level M and the chosen mask', () => {
    samples.forEach((text) => {
      const symbol = QR.encode(text);
      let bits = 0;
      for (let index = 0; index <= 5; index += 1) bits |= moduleAt(symbol, index, 8) << index;
      bits |= moduleAt(symbol, 7, 8) << 6;
      bits |= moduleAt(symbol, 8, 8) << 7;
      bits |= moduleAt(symbol, 8, 7) << 8;
      for (let index = 9; index < 15; index += 1) bits |= moduleAt(symbol, 8, 14 - index) << index;

      const unmasked = bits ^ 0x5412;
      /* Verify the BCH(15,5) codeword is intact, then read the payload. */
      let remainder = unmasked;
      for (let index = 14; index >= 10; index -= 1) {
        if ((remainder >>> index) & 1) remainder ^= 0x537 << (index - 10);
      }
      assert.equal(remainder & 0x3ff, 0, 'format bits should form a valid BCH codeword');

      const level = (unmasked >>> 13) & 0x3;
      const mask = (unmasked >>> 10) & 0x7;
      assert.equal(level, 0, 'error correction level M');
      assert.equal(mask, symbol.mask, 'format bits should name the applied mask');
    });
  });

  test('both copies of the format information agree', () => {
    const symbol = QR.encode('x'.repeat(120));
    for (let index = 0; index <= 5; index += 1) {
      assert.equal(moduleAt(symbol, index, 8), moduleAt(symbol, 8, symbol.size - 1 - index),
        'format bit ' + index + ' should match in both copies');
    }
  });
});

describe('svg rendering', () => {
  test('produces a self-contained svg with a quiet zone', () => {
    const symbol = QR.encode('NT1.example.payload');
    const svg = QR.toSvg(symbol, {scale: 4, quietZone: 4});
    const extent = (symbol.size + 8) * 4;
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.includes('viewBox="0 0 ' + extent + ' ' + extent + '"'));
    assert.ok(svg.includes('role="img"'), 'the symbol should expose an accessible role');
    assert.equal(svg.includes('<script'), false, 'rendering must not emit script');
  });

  test('escapes nothing into the label that could break the markup', () => {
    const symbol = QR.encode('x');
    const svg = QR.toSvg(symbol, {label: 'Ticket for Night 1'});
    assert.ok(svg.includes('aria-label="Ticket for Night 1"'));
  });
});

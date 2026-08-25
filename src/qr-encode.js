(function exposeQrEncode(root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * A real QR Code encoder (ISO/IEC 18004), byte mode, error correction
   * level M. This replaces the decorative CSS grid that never encoded
   * anything.
   *
   * Level M (about 15% recovery) is the working compromise for a ticket
   * read off a phone screen: enough redundancy to survive glare and a
   * cracked screen protector without inflating the symbol until it stops
   * fitting the viewfinder.
   *
   * Format and version information bits are computed from their BCH
   * generator polynomials rather than copied from a lookup table, so
   * there is no transcription error to hunt.
   * ------------------------------------------------------------------ */

  const EC_LEVEL_M = 0; /* the two format bits for level M */
  const MIN_VERSION = 1;
  const MAX_VERSION = 20;

  /* [ecCodewordsPerBlock, blocksGroup1, dataCodewordsGroup1, blocksGroup2, dataCodewordsGroup2] */
  const LEVEL_M_BLOCKS = [
    null,
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51],
    [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38],
    [24, 4, 40, 5, 41],
    [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46],
    [28, 10, 46, 1, 47],
    [26, 9, 43, 4, 44],
    [26, 3, 44, 11, 45],
    [26, 3, 41, 13, 42]
  ];

  const ALIGNMENT_POSITIONS = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
    [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
    [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90]
  ];

  function remainderBits(version) {
    if (version === 1) return 0;
    if (version <= 6) return 7;
    if (version <= 13) return 0;
    return 3; /* versions 14-20 */
  }

  /* ---- GF(256) arithmetic, primitive polynomial 0x11D ---- */

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function buildTables() {
    let value = 1;
    for (let index = 0; index < 255; index += 1) {
      EXP[index] = value;
      LOG[value] = index;
      value <<= 1;
      if (value & 0x100) value ^= 0x11d;
    }
    for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
  })();

  function gfMultiply(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function generatorPolynomial(degree) {
    let poly = new Uint8Array([1]);
    for (let index = 0; index < degree; index += 1) {
      const next = new Uint8Array(poly.length + 1);
      for (let position = 0; position < poly.length; position += 1) {
        next[position] ^= poly[position];
        next[position + 1] ^= gfMultiply(poly[position], EXP[index]);
      }
      poly = next;
    }
    return poly;
  }

  function errorCorrection(data, ecLength) {
    const generator = generatorPolynomial(ecLength);
    const remainder = new Uint8Array(ecLength);
    data.forEach((byte) => {
      const factor = byte ^ remainder[0];
      remainder.copyWithin(0, 1);
      remainder[ecLength - 1] = 0;
      if (factor !== 0) {
        for (let index = 0; index < ecLength; index += 1) {
          remainder[index] ^= gfMultiply(generator[index + 1], factor);
        }
      }
    });
    return remainder;
  }

  /* ---- BCH bits ---- */

  function formatBits(maskPattern) {
    const data = (EC_LEVEL_M << 3) | maskPattern; /* 5 bits */
    let remainder = data;
    for (let index = 0; index < 10; index += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    return ((data << 10) | remainder) ^ 0x5412;
  }

  function versionBits(version) {
    let remainder = version;
    for (let index = 0; index < 12; index += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    return (version << 12) | remainder;
  }

  /* ---- capacity ---- */

  function blockPlan(version) {
    const entry = LEVEL_M_BLOCKS[version];
    if (!entry) throw new RangeError('Unsupported QR version ' + version + '.');
    const [ecPerBlock, blocks1, data1, blocks2, data2] = entry;
    return {ecPerBlock, blocks1, data1, blocks2, data2, totalData: blocks1 * data1 + blocks2 * data2};
  }

  function characterCountBits(version) {
    return version <= 9 ? 8 : 16;
  }

  function capacityBytes(version) {
    const plan = blockPlan(version);
    const overhead = 4 + characterCountBits(version);
    return Math.floor((plan.totalData * 8 - overhead) / 8);
  }

  function chooseVersion(byteLength) {
    for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
      if (capacityBytes(version) >= byteLength) return version;
    }
    throw new RangeError('Payload of ' + byteLength + ' bytes exceeds QR version ' + MAX_VERSION + ' at level M.');
  }

  /* ---- bit stream ---- */

  function createBitBuffer() {
    const bits = [];
    return {
      push(value, length) {
        for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
      },
      get length() { return bits.length; },
      toCodewords(total) {
        while (bits.length % 8 !== 0) bits.push(0);
        const bytes = new Uint8Array(total);
        for (let index = 0; index < bits.length && index < total * 8; index += 1) {
          if (bits[index]) bytes[index >>> 3] |= 0x80 >>> (index & 7);
        }
        let cursor = Math.ceil(bits.length / 8);
        let pad = 0xec;
        while (cursor < total) {
          bytes[cursor] = pad;
          pad = pad === 0xec ? 0x11 : 0xec;
          cursor += 1;
        }
        return bytes;
      }
    };
  }

  function buildCodewords(bytes, version) {
    const plan = blockPlan(version);
    const buffer = createBitBuffer();
    buffer.push(0b0100, 4); /* byte mode */
    buffer.push(bytes.length, characterCountBits(version));
    bytes.forEach((byte) => buffer.push(byte, 8));

    const capacityBits = plan.totalData * 8;
    const terminator = Math.min(4, capacityBits - buffer.length);
    if (terminator > 0) buffer.push(0, terminator);

    const data = buffer.toCodewords(plan.totalData);

    /* Split into blocks, compute EC, then interleave. */
    const blocks = [];
    let cursor = 0;
    for (let index = 0; index < plan.blocks1; index += 1) {
      const slice = data.subarray(cursor, cursor + plan.data1);
      cursor += plan.data1;
      blocks.push({data: slice, ec: errorCorrection(slice, plan.ecPerBlock)});
    }
    for (let index = 0; index < plan.blocks2; index += 1) {
      const slice = data.subarray(cursor, cursor + plan.data2);
      cursor += plan.data2;
      blocks.push({data: slice, ec: errorCorrection(slice, plan.ecPerBlock)});
    }

    const maxData = Math.max(plan.data1, plan.data2);
    const result = [];
    for (let index = 0; index < maxData; index += 1) {
      blocks.forEach((block) => {
        if (index < block.data.length) result.push(block.data[index]);
      });
    }
    for (let index = 0; index < plan.ecPerBlock; index += 1) {
      blocks.forEach((block) => result.push(block.ec[index]));
    }
    return Uint8Array.from(result);
  }

  /* ---- matrix ---- */

  function createMatrix(version) {
    const size = version * 4 + 17;
    const modules = new Uint8Array(size * size);
    const reserved = new Uint8Array(size * size);
    const at = (row, col) => row * size + col;

    function set(row, col, dark) {
      modules[at(row, col)] = dark ? 1 : 0;
      reserved[at(row, col)] = 1;
    }

    function drawFinder(row, col) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const y = row + dy;
          const x = col + dx;
          if (y < 0 || y >= size || x < 0 || x >= size) continue;
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          set(y, x, distance !== 2 && distance !== 4);
        }
      }
    }

    drawFinder(3, 3);
    drawFinder(3, size - 4);
    drawFinder(size - 4, 3);

    /* Timing patterns */
    for (let index = 8; index < size - 8; index += 1) {
      set(6, index, index % 2 === 0);
      set(index, 6, index % 2 === 0);
    }

    /* Alignment patterns, skipping the three that collide with finders */
    const positions = ALIGNMENT_POSITIONS[version];
    const last = positions.length - 1;
    positions.forEach((row, rowIndex) => {
      positions.forEach((col, colIndex) => {
        if ((rowIndex === 0 && colIndex === 0) ||
            (rowIndex === 0 && colIndex === last) ||
            (rowIndex === last && colIndex === 0)) return;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            set(row + dy, col + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      });
    });

    /* Reserve the format areas so data placement skips them */
    for (let index = 0; index <= 5; index += 1) set(index, 8, false);
    set(7, 8, false);
    set(8, 8, false);
    set(8, 7, false);
    for (let index = 9; index < 15; index += 1) set(8, 14 - index, false);
    for (let index = 0; index < 8; index += 1) set(8, size - 1 - index, false);
    for (let index = 8; index < 15; index += 1) set(size - 15 + index, 8, false);
    set(size - 8, 8, true); /* always dark */

    if (version >= 7) {
      const bits = versionBits(version);
      for (let index = 0; index < 18; index += 1) {
        const bit = (bits >>> index) & 1;
        const a = size - 11 + (index % 3);
        const b = Math.floor(index / 3);
        set(b, a, bit);
        set(a, b, bit);
      }
    }

    return {size, modules, reserved, at};
  }

  function placeCodewords(matrix, codewords) {
    const {size, modules, reserved, at} = matrix;
    let bitIndex = 0;
    const totalBits = codewords.length * 8;

    for (let right = size - 1; right >= 1; right -= 2) {
      /* The vertical timing pattern occupies column 6, so the traversal
         shifts left by one and continues from there. This must move the
         cursor itself, not just the column read this pass, or the leftmost
         pair is misaligned and column 0 never receives data. */
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical += 1) {
        for (let offset = 0; offset < 2; offset += 1) {
          const col = right - offset;
          const upward = ((right + 1) & 2) === 0;
          const row = upward ? size - 1 - vertical : vertical;
          if (reserved[at(row, col)]) continue;
          let bit = 0;
          if (bitIndex < totalBits) {
            bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            bitIndex += 1;
          }
          modules[at(row, col)] = bit;
        }
      }
    }
    return matrix;
  }

  const MASKS = [
    (row, col) => (row + col) % 2 === 0,
    (row) => row % 2 === 0,
    (row, col) => col % 3 === 0,
    (row, col) => (row + col) % 3 === 0,
    (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
    (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
    (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
    (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  ];

  function applyMask(matrix, maskIndex) {
    const {size, modules, reserved, at} = matrix;
    const mask = MASKS[maskIndex];
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (reserved[at(row, col)]) continue;
        if (mask(row, col)) modules[at(row, col)] ^= 1;
      }
    }
  }

  function drawFormat(matrix, maskIndex) {
    const {size, modules, at} = matrix;
    const bits = formatBits(maskIndex);
    const bit = (index) => (bits >>> index) & 1;

    for (let index = 0; index <= 5; index += 1) modules[at(index, 8)] = bit(index);
    modules[at(7, 8)] = bit(6);
    modules[at(8, 8)] = bit(7);
    modules[at(8, 7)] = bit(8);
    for (let index = 9; index < 15; index += 1) modules[at(8, 14 - index)] = bit(index);

    for (let index = 0; index < 8; index += 1) modules[at(8, size - 1 - index)] = bit(index);
    for (let index = 8; index < 15; index += 1) modules[at(size - 15 + index, 8)] = bit(index);
    modules[at(size - 8, 8)] = 1;
  }

  function penalty(matrix) {
    const {size, modules, at} = matrix;
    let score = 0;

    /* Rule 1: runs of five or more identical modules */
    for (let row = 0; row < size; row += 1) {
      let runValue = modules[at(row, 0)];
      let runLength = 1;
      for (let col = 1; col < size; col += 1) {
        const value = modules[at(row, col)];
        if (value === runValue) {
          runLength += 1;
        } else {
          if (runLength >= 5) score += 3 + (runLength - 5);
          runValue = value;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += 3 + (runLength - 5);
    }
    for (let col = 0; col < size; col += 1) {
      let runValue = modules[at(0, col)];
      let runLength = 1;
      for (let row = 1; row < size; row += 1) {
        const value = modules[at(row, col)];
        if (value === runValue) {
          runLength += 1;
        } else {
          if (runLength >= 5) score += 3 + (runLength - 5);
          runValue = value;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += 3 + (runLength - 5);
    }

    /* Rule 2: 2x2 blocks of one colour */
    for (let row = 0; row < size - 1; row += 1) {
      for (let col = 0; col < size - 1; col += 1) {
        const value = modules[at(row, col)];
        if (value === modules[at(row, col + 1)] &&
            value === modules[at(row + 1, col)] &&
            value === modules[at(row + 1, col + 1)]) {
          score += 3;
        }
      }
    }

    /* Rule 3: finder-like 1:1:3:1:1 patterns with four light modules beside */
    const forward = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const backward = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matches(getter, start) {
      let hitForward = true;
      let hitBackward = true;
      for (let index = 0; index < 11; index += 1) {
        const value = getter(start + index);
        if (value !== forward[index]) hitForward = false;
        if (value !== backward[index]) hitBackward = false;
      }
      return (hitForward ? 1 : 0) + (hitBackward ? 1 : 0);
    }
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col + 11 <= size; col += 1) {
        score += 40 * matches((index) => modules[at(row, index)], col);
      }
    }
    for (let col = 0; col < size; col += 1) {
      for (let row = 0; row + 11 <= size; row += 1) {
        score += 40 * matches((index) => modules[at(index, col)], row);
      }
    }

    /* Rule 4: deviation from an even dark/light split */
    let dark = 0;
    for (let index = 0; index < modules.length; index += 1) dark += modules[index];
    const percent = (dark * 100) / (size * size);
    score += 10 * Math.floor(Math.abs(percent - 50) / 5);

    return score;
  }

  /**
   * Encode text as a QR symbol.
   * Returns {version, size, modules} where modules is a size*size Uint8Array
   * of 0 (light) and 1 (dark), row major, with no quiet zone included.
   */
  function encode(text) {
    if (typeof text !== 'string' || !text) throw new TypeError('QR input must be a non-empty string.');
    const bytes = new TextEncoder().encode(text);
    const version = chooseVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);

    let best = null;
    for (let maskIndex = 0; maskIndex < 8; maskIndex += 1) {
      const matrix = placeCodewords(createMatrix(version), codewords);
      applyMask(matrix, maskIndex);
      drawFormat(matrix, maskIndex);
      const score = penalty(matrix);
      if (!best || score < best.score) best = {score, matrix, maskIndex};
    }

    return {
      version,
      size: best.matrix.size,
      mask: best.maskIndex,
      modules: best.matrix.modules,
      capacityBytes: capacityBytes(version)
    };
  }

  /**
   * Render to an SVG string. One path of rectangles keeps the DOM small
   * enough to re-render on every state change without jank.
   */
  function toSvg(symbol, options) {
    const settings = options || {};
    const quiet = settings.quietZone == null ? 4 : settings.quietZone;
    const scale = settings.scale == null ? 1 : settings.scale;
    const dark = settings.dark || '#17141f';
    const light = settings.light || '#ffffff';
    const extent = (symbol.size + quiet * 2) * scale;

    let path = '';
    for (let row = 0; row < symbol.size; row += 1) {
      for (let col = 0; col < symbol.size; col += 1) {
        if (symbol.modules[row * symbol.size + col]) {
          path += 'M' + ((col + quiet) * scale) + ' ' + ((row + quiet) * scale) + 'h' + scale + 'v' + scale + 'h-' + scale + 'z';
        }
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + extent + ' ' + extent + '" ' +
      'width="' + extent + '" height="' + extent + '" shape-rendering="crispEdges" role="img" ' +
      'aria-label="' + (settings.label || 'Ticket QR code') + '">' +
      '<rect width="' + extent + '" height="' + extent + '" fill="' + light + '"/>' +
      '<path d="' + path + '" fill="' + dark + '"/></svg>';
  }

  /* Exposed so tests can assert the codeword stage (terminator, padding,
     block interleaving) independently of module placement. */
  function codewordsFor(text, version) {
    const bytes = new TextEncoder().encode(text);
    return buildCodewords(bytes, version == null ? chooseVersion(bytes.length) : version);
  }

  root.NonsenseQR = Object.freeze({
    encode,
    toSvg,
    capacityBytes,
    chooseVersion,
    codewordsFor,
    MAX_VERSION
  });
})(globalThis);

import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {before, describe, test} from 'node:test';

let Decoder;

before(async () => {
  const url = new URL('../src/scanner/qr-decoder.js', import.meta.url);
  assert.equal(existsSync(url), true, 'src/scanner/qr-decoder.js should exist');
  await import(url.href);
  Decoder = globalThis.NonsenseQrDecoder;
});

describe('scanner QR decoder selection', () => {
  test('prefers native BarcodeDetector when QR detection is supported', async () => {
    class NativeDetector {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect(frame) {
        assert.equal(frame.id, 'camera-frame');
        return [{rawValue: 'NT1.exact.native'}];
      }
    }

    const decoder = await Decoder.createDecoder({
      BarcodeDetector: NativeDetector,
      jsQR: () => { throw new Error('fallback must not run'); }
    });

    assert.equal(decoder.kind, 'native');
    assert.equal(await decoder.decode({id: 'camera-frame'}), 'NT1.exact.native');
  });

  test('uses one reusable canvas and jsQR when native detection is unavailable', async () => {
    const pixels = new Uint8ClampedArray(4 * 3 * 2);
    const draws = [];
    const context = {
      drawImage(frame, x, y, width, height) { draws.push({frame, x, y, width, height}); },
      getImageData(x, y, width, height) {
        assert.deepEqual({x, y, width, height}, {x: 0, y: 0, width: 3, height: 2});
        return {data: pixels};
      }
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext(kind, options) {
        assert.equal(kind, '2d');
        assert.deepEqual(options, {willReadFrequently: true});
        return context;
      }
    };
    let canvasCount = 0;
    let fallbackCount = 0;
    const decoder = await Decoder.createDecoder({
      BarcodeDetector: undefined,
      createCanvas() { canvasCount += 1; return canvas; },
      jsQR(data, width, height, options) {
        fallbackCount += 1;
        assert.equal(data, pixels);
        assert.deepEqual({width, height, options}, {
          width: 3,
          height: 2,
          options: {inversionAttempts: 'dontInvert'}
        });
        return {data: 'NT1.exact.fallback'};
      }
    });

    assert.equal(decoder.kind, 'jsqr');
    assert.equal(await decoder.decode({videoWidth: 3, videoHeight: 2}), 'NT1.exact.fallback');
    assert.equal(await decoder.decode({videoWidth: 3, videoHeight: 2}), 'NT1.exact.fallback');
    assert.equal(canvasCount, 1);
    assert.equal(fallbackCount, 2);
    assert.equal(draws.length, 2);
    assert.deepEqual({width: canvas.width, height: canvas.height}, {width: 3, height: 2});
  });

  test('falls back when native capability detection fails or omits QR', async () => {
    class BrokenDetector {
      static async getSupportedFormats() { throw new Error('not implemented'); }
    }
    class NoQrDetector {
      static async getSupportedFormats() { return ['code_128']; }
    }
    const createCanvas = () => ({
      getContext: () => ({drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray(4)})})
    });

    const broken = await Decoder.createDecoder({BarcodeDetector: BrokenDetector, jsQR: () => null, createCanvas});
    const unsupported = await Decoder.createDecoder({BarcodeDetector: NoQrDetector, jsQR: () => null, createCanvas});
    assert.equal(broken.kind, 'jsqr');
    assert.equal(unsupported.kind, 'jsqr');
  });

  test('reports that no camera decoder is available', async () => {
    await assert.rejects(
      () => Decoder.createDecoder({BarcodeDetector: undefined, jsQR: undefined}),
      /No QR decoder is available/
    );
  });
});

(function exposeQrDecoder(root) {
  'use strict';

  function dependency(settings, name, fallback) {
    return Object.prototype.hasOwnProperty.call(settings, name) ? settings[name] : fallback;
  }

  async function nativeDecoder(BarcodeDetector) {
    if (typeof BarcodeDetector !== 'function' || typeof BarcodeDetector.getSupportedFormats !== 'function') {
      return null;
    }

    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (!Array.isArray(formats) || !formats.includes('qr_code')) return null;
      const detector = new BarcodeDetector({formats: ['qr_code']});
      return Object.freeze({
        kind: 'native',
        async decode(source) {
          const codes = await detector.detect(source);
          if (!Array.isArray(codes) || !codes.length) return null;
          return typeof codes[0].rawValue === 'string' ? codes[0].rawValue : null;
        }
      });
    } catch {
      return null;
    }
  }

  function fallbackDecoder(jsQR, createCanvas) {
    if (typeof jsQR !== 'function') return null;
    if (typeof createCanvas !== 'function') {
      throw new Error('The jsQR fallback requires a canvas implementation.');
    }

    const canvas = createCanvas();
    const context = canvas && canvas.getContext
      ? canvas.getContext('2d', {willReadFrequently: true})
      : null;
    if (!context) throw new Error('The jsQR fallback could not create a 2D canvas context.');

    return Object.freeze({
      kind: 'jsqr',
      async decode(source) {
        const width = Number(source && (source.videoWidth || source.width)) || 0;
        const height = Number(source && (source.videoHeight || source.height)) || 0;
        if (width < 1 || height < 1) return null;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        context.drawImage(source, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        const result = jsQR(image.data, width, height, {inversionAttempts: 'dontInvert'});
        return result && typeof result.data === 'string' ? result.data : null;
      }
    });
  }

  async function createDecoder(options) {
    const settings = options || {};
    const BarcodeDetector = dependency(settings, 'BarcodeDetector', root.BarcodeDetector);
    const native = await nativeDecoder(BarcodeDetector);
    if (native) return native;

    const jsQR = dependency(settings, 'jsQR', root.jsQR);
    const createCanvas = dependency(settings, 'createCanvas', () => root.document.createElement('canvas'));
    const fallback = fallbackDecoder(jsQR, createCanvas);
    if (fallback) return fallback;

    throw new Error('No QR decoder is available on this device.');
  }

  root.NonsenseQrDecoder = Object.freeze({createDecoder});
})(globalThis);

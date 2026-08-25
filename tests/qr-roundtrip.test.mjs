import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {before, describe, test} from 'node:test';

/* Decode with the vendored jsQR bundle that the door PWA actually loads,
   rather than an npm copy of it. Two reasons: these assertions then cover the
   exact artifact shipped to a door device, and the suite keeps running with no
   install step, which is what CI does (`npm test`, no `npm ci`).

   The bundle is UMD and assigns to `self` in a browser, so it is evaluated the
   same way here. */
function loadVendoredJsQr() {
  const source = readFileSync(new URL('../src/scanner/vendor/jsQR.js', import.meta.url), 'utf8');
  const sandbox = {self: {}, console};
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(source, sandbox);
  if (typeof sandbox.self.jsQR !== 'function') {
    throw new Error('src/scanner/vendor/jsQR.js did not expose jsQR.');
  }
  return sandbox.self.jsQR;
}

const jsQR = loadVendoredJsQr();

let Payload;
let Manifest;
let Scanner;
let QR;

const EVENT_ID = 'afterbreak-2026';
const TICKET_ID = '01J4Z6N2HK9QW7M3TX5RC8VBPF';
const ISSUED_AT = Math.floor(Date.parse('2026-08-01T12:00:00Z') / 1000);
const EXPIRES_AT = Math.floor(Date.parse('2026-09-13T12:00:00Z') / 1000);
const NIGHT_1_SCAN = Math.floor(Date.parse('2026-09-11T23:50:00-04:00') / 1000);
const NIGHT_2_SCAN = Math.floor(Date.parse('2026-09-12T23:50:00-04:00') / 1000);

before(async () => {
  for (const path of ['ticket-payload.js', 'ticket-manifest.js', 'scanner-core.js', 'qr-encode.js']) {
    const url = new URL('../src/' + path, import.meta.url);
    assert.equal(existsSync(url), true, 'src/' + path + ' should exist');
    await import(url.href);
  }
  Payload = globalThis.NonsenseTicketPayload;
  Manifest = globalThis.NonsenseTicketManifest;
  Scanner = globalThis.NonsenseScannerCore;
  QR = globalThis.NonsenseQR;
});

function rasterize(symbol, options = {}) {
  const scale = options.scale || 4;
  const quiet = 4;
  const dark = options.dark == null ? 0 : options.dark;
  const light = options.light == null ? 255 : options.light;
  const side = (symbol.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4);

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const moduleRow = Math.floor(y / scale) - quiet;
      const moduleColumn = Math.floor(x / scale) - quiet;
      const inSymbol = moduleRow >= 0 && moduleRow < symbol.size && moduleColumn >= 0 && moduleColumn < symbol.size;
      const isDark = inSymbol && symbol.modules[moduleRow * symbol.size + moduleColumn] === 1;
      const value = isDark ? dark : light;
      const offset = (y * side + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  if (options.glare) {
    const startX = Math.floor(side * 0.55);
    const startY = Math.floor(side * 0.46);
    const width = scale * 3;
    const height = scale * 5;
    for (let y = startY; y < startY + height; y += 1) {
      for (let x = startX; x < startX + width; x += 1) {
        const offset = (y * side + x) * 4;
        data[offset] = light;
        data[offset + 1] = light;
        data[offset + 2] = light;
      }
    }
  }

  return {data, width: side, height: side};
}

function decodeSymbol(symbol, options) {
  const image = rasterize(symbol, options);
  const decoded = jsQR(image.data, image.width, image.height, {inversionAttempts: 'dontInvert'});
  assert.ok(decoded, 'jsQR should decode the rendered symbol');
  return decoded.data;
}

async function ticketWorld() {
  const signer = await Payload.generateSigningKeyPair();
  const payload = await Payload.encodeTicketPayload({
    keyId: signer.keyId,
    eventId: EVENT_ID,
    ticketId: TICKET_ID,
    sessionIds: ['night-1', 'night-2'],
    serial: 1,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT
  }, signer.privateKey);
  const manifest = {
    eventId: EVENT_ID,
    version: 1,
    keys: [{kid: signer.keyId, jwk: signer.publicKeyJwk}],
    revoked: [],
    minSerials: {},
    sessions: [
      {id: 'night-1', label: 'Night 1', opensAt: NIGHT_1_SCAN - 3600, closesAt: NIGHT_1_SCAN + 3600},
      {id: 'night-2', label: 'Night 2', opensAt: NIGHT_2_SCAN - 3600, closesAt: NIGHT_2_SCAN + 3600}
    ]
  };
  return {signer, payload, manifest};
}

describe('independent signed-ticket QR round trip', () => {
  test('decodes the exact NT1 document and verifies its signature', async () => {
    const world = await ticketWorld();
    const decoded = decodeSymbol(QR.encode(world.payload));

    assert.equal(decoded, world.payload);
    const verified = await Payload.verifyTicketPayload(
      decoded,
      Manifest.ticketKeysFromManifest(world.manifest),
      {now: NIGHT_1_SCAN}
    );
    assert.equal(verified.status, 'valid');
  });

  test('preserves combo admission once per granted session', async () => {
    const world = await ticketWorld();
    const decoded = decodeSymbol(QR.encode(world.payload));
    const night1 = Scanner.createScanner({manifest: world.manifest, deviceId: 'door-night-1'});
    const night2 = Scanner.createScanner({manifest: world.manifest, deviceId: 'door-night-2'});

    assert.equal((await night1.evaluate(decoded, {sessionId: 'night-1', now: NIGHT_1_SCAN})).result, 'admitted');
    assert.equal((await night1.evaluate(decoded, {sessionId: 'night-1', now: NIGHT_1_SCAN + 1})).result, 'duplicate');
    assert.equal((await night2.evaluate(decoded, {sessionId: 'night-2', now: NIGHT_2_SCAN})).result, 'admitted');
    assert.equal((await night2.evaluate(decoded, {sessionId: 'night-2', now: NIGHT_2_SCAN + 1})).result, 'duplicate');
  });

  test('survives synthetic distance, brightness, contrast, and glare cases', async () => {
    const world = await ticketWorld();
    const symbol = QR.encode(world.payload);
    const cases = [
      {name: 'baseline', options: {scale: 5, dark: 0, light: 255}},
      {name: 'small modules', options: {scale: 2, dark: 0, light: 255}},
      {name: 'dim display', options: {scale: 4, dark: 0, light: 125}},
      {name: 'reduced contrast', options: {scale: 4, dark: 75, light: 175}},
      {name: 'bounded glare', options: {scale: 4, dark: 0, light: 255, glare: true}}
    ];

    for (const entry of cases) {
      assert.equal(decodeSymbol(symbol, entry.options), world.payload, entry.name);
    }
  });
});

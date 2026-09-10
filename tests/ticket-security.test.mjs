import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, test, before } from 'node:test';

/* Adversarial coverage for the paths where being wrong admits the wrong
   person: forgery, wrong event, duplicates, combo admission, revocation,
   transfer, and two offline devices that disagree. */

const modules = ['ticket-schema.js', 'ticket-payload.js', 'ticket-manifest.js', 'ticket-issuer.js', 'scanner-core.js'];

let Schema;
let Payload;
let Manifest;
let Issuer;
let Scanner;

before(async () => {
  for (const name of modules) {
    const url = new URL('../src/' + name, import.meta.url);
    assert.equal(existsSync(url), true, 'src/' + name + ' should exist');
    await import(url.href);
  }
  Schema = globalThis.NonsenseTicketSchema;
  Payload = globalThis.NonsenseTicketPayload;
  Manifest = globalThis.NonsenseTicketManifest;
  Issuer = globalThis.NonsenseTicketIssuer;
  Scanner = globalThis.NonsenseScannerCore;
});

/* A fixed clock keeps every assertion reproducible. */
const NIGHT_1_DOORS = Math.floor(Date.parse('2026-09-11T23:00:00-04:00') / 1000);
const NIGHT_1_SCAN = Math.floor(Date.parse('2026-09-11T23:50:00-04:00') / 1000);
const NIGHT_1_CLOSE = Math.floor(Date.parse('2026-09-12T04:00:00-04:00') / 1000);
const NIGHT_2_DOORS = Math.floor(Date.parse('2026-09-12T23:00:00-04:00') / 1000);
const NIGHT_2_SCAN = Math.floor(Date.parse('2026-09-12T23:50:00-04:00') / 1000);
const NIGHT_2_CLOSE = Math.floor(Date.parse('2026-09-13T04:00:00-04:00') / 1000);
const ISSUE_MS = Date.parse('2026-08-01T12:00:00Z');
const EXPIRES = Math.floor(Date.parse('2026-09-13T12:00:00Z') / 1000);
const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const P256_HALF_ORDER = P256_ORDER >> 1n;

const EVENT_ID = 'afterbreak-2026';

function signatureScalar(bytes) {
  let value = 0n;
  for (let index = 32; index < 64; index += 1) value = (value << 8n) | BigInt(bytes[index]);
  return value;
}

function signatureWithScalar(bytes, scalar) {
  const result = bytes.slice();
  let remaining = scalar;
  for (let index = 63; index >= 32; index -= 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function forceSignatureForm(document, high) {
  const segments = document.split('.');
  const signature = Payload.base64UrlDecode(segments[2]);
  const scalar = signatureScalar(signature);
  const low = scalar <= P256_HALF_ORDER ? scalar : P256_ORDER - scalar;
  const selected = high ? P256_ORDER - low : low;
  segments[2] = Payload.base64UrlEncode(signatureWithScalar(signature, selected));
  return segments.join('.');
}

async function signManifestDocument(manifest, privateKey) {
  const body = Manifest.canonicalJson(manifest);
  const signingInput = Manifest.PREFIX + '.' + Payload.base64UrlEncode(new TextEncoder().encode(body));
  const signature = new Uint8Array(await crypto.subtle.sign(
    {name: 'ECDSA', hash: 'SHA-256'},
    privateKey,
    new TextEncoder().encode(signingInput)
  ));
  const scalar = signatureScalar(signature);
  const low = scalar <= P256_HALF_ORDER ? scalar : P256_ORDER - scalar;
  return signingInput + '.' + Payload.base64UrlEncode(signatureWithScalar(signature, low));
}

async function buildWorld(overrides = {}) {
  const publisher = await Payload.generateSigningKeyPair();
  const signer = overrides.signer || publisher;

  const manifestInput = {
    eventId: EVENT_ID,
    version: overrides.version || 1,
    issuedAt: Math.floor(ISSUE_MS / 1000),
    expiresAt: EXPIRES + 86400,
    timeZone: 'America/New_York',
    title: 'AfterBreak 2026',
    sessions: [
      {id: 'night-1', label: 'Night 1', startsAt: NIGHT_1_DOORS, opensAt: NIGHT_1_DOORS, closesAt: NIGHT_1_CLOSE},
      {id: 'night-2', label: 'Night 2', startsAt: NIGHT_2_DOORS, opensAt: NIGHT_2_DOORS, closesAt: NIGHT_2_CLOSE}
    ],
    keys: [{kid: signer.keyId, jwk: signer.publicKeyJwk}],
    revoked: overrides.revoked || [],
    minSerials: overrides.minSerials || {}
  };

  const built = await Manifest.buildManifest(manifestInput, publisher.privateKey);
  const verified = await Manifest.verifyManifest(built.document, {publisher: publisher.publicKeyJwk}, {now: NIGHT_1_SCAN});
  assert.equal(verified.status, 'valid', 'test manifest should verify');

  return {publisher, signer, document: built.document, manifest: verified.manifest};
}

function offer(id, sessionIds, facePriceCents) {
  return {
    id, eventId: EVENT_ID, label: id, facePriceCents, feeCents: 100,
    sessionIds, status: 'available'
  };
}

function order(offerRecord, quantity = 1) {
  return {
    id: Issuer.newOpaqueId(ISSUE_MS),
    eventId: EVENT_ID,
    offerId: offerRecord.id,
    buyerRef: Issuer.newOpaqueId(ISSUE_MS),
    quantity,
    facePriceCents: offerRecord.facePriceCents,
    feeCents: offerRecord.feeCents,
    totalCents: (offerRecord.facePriceCents + offerRecord.feeCents) * quantity,
    status: 'paid',
    createdAt: new Date(ISSUE_MS).toISOString()
  };
}

async function issueOne(world, offerRecord) {
  const offerInput = offerRecord || offer('combo-early-bird', ['night-1', 'night-2'], 4000);
  const result = await Issuer.issueTickets({
    order: order(offerInput),
    offer: offerInput,
    keyId: world.signer.keyId,
    privateKey: world.signer.privateKey,
    nowMs: ISSUE_MS,
    expiresAt: EXPIRES
  });
  return {...result, offer: offerInput};
}

function scannerFor(world, deviceId = 'door-main') {
  return Scanner.createScanner({manifest: world.manifest, deviceId});
}

describe('signed ticket payload', () => {
  test('a genuine payload verifies and carries no personal data', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const decoded = Payload.decodeTicketPayload(issued.payloads[0].payload);

    assert.equal(decoded.claims.eventId, EVENT_ID);
    assert.deepEqual(decoded.claims.sessionIds, ['night-1', 'night-2']);

    const fields = Object.keys(JSON.parse(Buffer.from(issued.payloads[0].payload.split('.')[1], 'base64url').toString()));
    assert.deepEqual(fields.sort(), ['e', 'i', 'k', 'n', 's', 't', 'v', 'x']);
    /* No holder, buyer, order, email, or name field exists to leak. */
    assert.equal(fields.includes('holderRef'), false);
    assert.equal(fields.includes('orderId'), false);
  });

  test('the payload carries no algorithm field to downgrade', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const body = JSON.parse(Buffer.from(issued.payloads[0].payload.split('.')[1], 'base64url').toString());
    assert.equal('alg' in body, false);
    assert.equal(issued.payloads[0].payload.startsWith('NT1.'), true);
  });

  test('a payload signed by an untrusted key is rejected', async () => {
    const world = await buildWorld();
    const attacker = await Payload.generateSigningKeyPair();
    const forged = await Payload.encodeTicketPayload({
      keyId: world.signer.keyId, /* claims the real key id */
      eventId: EVENT_ID,
      ticketId: Issuer.newOpaqueId(ISSUE_MS),
      sessionIds: ['night-1', 'night-2'],
      serial: 1,
      issuedAt: Math.floor(ISSUE_MS / 1000),
      expiresAt: EXPIRES
    }, attacker.privateKey);

    const decision = await scannerFor(world).evaluate(forged, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(decision.result, 'bad_signature');
  });

  test('editing a claim invalidates the signature', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world, offer('ga-night-1', ['night-1'], 2500));
    const [prefix, body, signature] = issued.payloads[0].payload.split('.');
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString());
    tampered.s = ['night-1', 'night-2']; /* upgrade a one-night ticket to a combo */
    const forged = prefix + '.' + Buffer.from(JSON.stringify(tampered)).toString('base64url') + '.' + signature;

    const decision = await scannerFor(world).evaluate(forged, {sessionId: 'night-2', now: NIGHT_2_SCAN});
    assert.equal(decision.result, 'bad_signature');
  });

  test('a non-canonical re-encoding of a real payload is refused', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const [prefix, body, signature] = issued.payloads[0].payload.split('.');
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
    /* Same claims, different key order. One ticket must have one encoding. */
    const reordered = {k: parsed.k, v: parsed.v, e: parsed.e, t: parsed.t, s: parsed.s, n: parsed.n, i: parsed.i, x: parsed.x};
    const rebuilt = prefix + '.' + Buffer.from(JSON.stringify(reordered)).toString('base64url') + '.' + signature;

    const decision = await scannerFor(world).evaluate(rebuilt, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(decision.result, 'bad_signature');
  });

  test('base64url with non-zero padding bits is refused', () => {
    assert.throws(() => Payload.base64UrlDecode('AB'), /canonical/);
    assert.deepEqual(Array.from(Payload.base64UrlDecode('AQ')), [1]);
  });

  test('a high-S signature twin is rejected', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const high = forceSignatureForm(issued.payloads[0].payload, true);
    const result = await Payload.verifyTicketPayload(
      high,
      Manifest.ticketKeysFromManifest(world.manifest),
      {now: NIGHT_1_SCAN}
    );

    assert.equal(result.status, 'bad_signature');
    assert.match(result.reason, /low-S/);
  });
});

describe('door admission', () => {
  test('a valid ticket is admitted once and rejected the second time', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const door = scannerFor(world);
    const payload = issued.payloads[0].payload;

    const first = await door.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(first.result, 'admitted');

    const second = await door.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN + 30});
    assert.equal(second.result, 'duplicate');
    assert.equal(second.firstScannedAt, NIGHT_1_SCAN);
    assert.equal(door.admittedCount(), 1);
  });

  test('a combo ticket admits once on each granted night', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const door = scannerFor(world);
    const payload = issued.payloads[0].payload;

    assert.equal((await door.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN})).result, 'admitted');
    assert.equal((await door.evaluate(payload, {sessionId: 'night-2', now: NIGHT_2_SCAN})).result, 'admitted');
    assert.equal((await door.evaluate(payload, {sessionId: 'night-2', now: NIGHT_2_SCAN + 60})).result, 'duplicate');
    assert.equal(door.admittedCount(), 2);
  });

  test('a single-night ticket is refused at the other night', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world, offer('ga-night-1', ['night-1'], 2500));
    const door = scannerFor(world);

    const decision = await door.evaluate(issued.payloads[0].payload, {sessionId: 'night-2', now: NIGHT_2_SCAN});
    assert.equal(decision.result, 'not_entitled');
    assert.equal(door.admittedCount(), 0);
  });

  test('a ticket for another event is refused', async () => {
    const world = await buildWorld();
    const stranger = await Payload.encodeTicketPayload({
      keyId: world.signer.keyId,
      eventId: 'some-other-show',
      ticketId: Issuer.newOpaqueId(ISSUE_MS),
      sessionIds: ['night-1'],
      serial: 1,
      issuedAt: Math.floor(ISSUE_MS / 1000),
      expiresAt: EXPIRES
    }, world.signer.privateKey);

    const decision = await scannerFor(world).evaluate(stranger, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(decision.result, 'wrong_event');
  });

  test('a revoked ticket is refused offline from the cached manifest', async () => {
    const base = await buildWorld();
    const issued = await issueOne(base);
    const ticketId = issued.tickets[0].id;

    const world = await buildWorld({signer: base.signer, version: 2, revoked: [ticketId]});
    const decision = await scannerFor(world).evaluate(issued.payloads[0].payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(decision.result, 'revoked');
  });

  test('a scan outside the door window is refused', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const decision = await scannerFor(world).evaluate(issued.payloads[0].payload, {
      sessionId: 'night-1',
      now: NIGHT_1_DOORS - 7200
    });
    assert.equal(decision.result, 'outside_window');
  });

  test('an expired payload is refused but still reads as a real ticket', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const door = scannerFor(world);
    const decision = await door.evaluate(issued.payloads[0].payload, {sessionId: 'night-2', now: EXPIRES + 3600});
    assert.equal(decision.result, 'expired');
    assert.equal(decision.ticketId, issued.tickets[0].id, 'an expired ticket is still identifiable');
  });

  test('a rejected scan never consumes the admission', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const door = scannerFor(world);
    const payload = issued.payloads[0].payload;

    await door.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_DOORS - 7200}); /* outside_window */
    const later = await door.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(later.result, 'admitted', 'an early scan attempt must not burn the ticket');
  });
});

describe('face-value transfer', () => {
  test('after transfer the old copy is superseded and the new copy admits', async () => {
    const base = await buildWorld();
    const issued = await issueOne(base);
    const original = issued.payloads[0].payload;

    const transfer = await Issuer.transferTicket({
      ticket: issued.tickets[0],
      toHolderRef: Issuer.newOpaqueId(ISSUE_MS),
      entitlements: issued.entitlements,
      keyId: base.signer.keyId,
      privateKey: base.signer.privateKey,
      nowMs: ISSUE_MS + 3600000,
      expiresAt: EXPIRES
    });

    /* The door only learns about the transfer through a newer manifest. */
    const world = await buildWorld({
      signer: base.signer,
      version: 2,
      minSerials: {[issued.tickets[0].id]: transfer.minSerial}
    });
    const door = scannerFor(world);

    const stale = await door.evaluate(original, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(stale.result, 'superseded', 'the previous holder screenshot must stop working');

    const fresh = await door.evaluate(transfer.payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(fresh.result, 'admitted');
  });

  test('a door still running the old manifest admits the old copy', async () => {
    const base = await buildWorld();
    const issued = await issueOne(base);
    const door = scannerFor(base); /* version 1, transfer not yet synced */

    const decision = await door.evaluate(issued.payloads[0].payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(decision.result, 'admitted',
      'a stale manifest cannot know about a transfer - this is the documented offline limit');
  });

  test('transfer derives grants from validated active entitlements', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world, offer('ga-night-1', ['night-1'], 2500));

    const transfer = await Issuer.transferTicket({
      ticket: issued.tickets[0],
      toHolderRef: Issuer.newOpaqueId(ISSUE_MS + 1),
      entitlements: issued.entitlements,
      keyId: world.signer.keyId,
      privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS + 3600000,
      expiresAt: EXPIRES
    });

    assert.deepEqual(Payload.decodeTicketPayload(transfer.payload).claims.sessionIds, ['night-1']);
  });

  test('transfer refuses caller-selected session grants', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world, offer('ga-night-1', ['night-1'], 2500));

    await assert.rejects(() => Issuer.transferTicket({
      ticket: issued.tickets[0],
      toHolderRef: Issuer.newOpaqueId(ISSUE_MS + 1),
      entitlements: issued.entitlements,
      sessionIds: ['night-1', 'night-2'],
      keyId: world.signer.keyId,
      privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS + 3600000,
      expiresAt: EXPIRES
    }), /sessionIds must not be supplied/);
  });

  test('transfer refuses inactive or foreign entitlements', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world, offer('ga-night-1', ['night-1'], 2500));
    const shared = {
      ticket: issued.tickets[0],
      toHolderRef: Issuer.newOpaqueId(ISSUE_MS + 1),
      keyId: world.signer.keyId,
      privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS + 3600000,
      expiresAt: EXPIRES
    };

    await assert.rejects(() => Issuer.transferTicket({
      ...shared,
      entitlements: [{...issued.entitlements[0], status: 'revoked'}]
    }), /active entitlement/);
    await assert.rejects(() => Issuer.transferTicket({
      ...shared,
      entitlements: [{...issued.entitlements[0], ticketId: Issuer.newOpaqueId(ISSUE_MS + 2)}]
    }), /matching the transferred ticket/);
  });
});

describe('offline manifest', () => {
  test('a manifest signed by an untrusted publisher is rejected', async () => {
    const world = await buildWorld();
    const attacker = await Payload.generateSigningKeyPair();
    const forged = await Manifest.buildManifest({
      eventId: EVENT_ID, version: 99, issuedAt: Math.floor(ISSUE_MS / 1000), expiresAt: EXPIRES + 86400,
      sessions: [{id: 'night-1', label: 'Night 1', startsAt: NIGHT_1_DOORS, opensAt: NIGHT_1_DOORS, closesAt: NIGHT_1_CLOSE}],
      keys: [{kid: attacker.keyId, jwk: attacker.publicKeyJwk}]
    }, attacker.privateKey);

    const result = await Manifest.verifyManifest(forged.document, {publisher: world.publisher.publicKeyJwk}, {now: NIGHT_1_SCAN});
    assert.equal(result.status, 'bad_signature');
  });

  test('an older signed manifest cannot roll back a revocation', async () => {
    const publisher = await Payload.generateSigningKeyPair();
    const signer = await Payload.generateSigningKeyPair();
    const sessions = [{id: 'night-1', label: 'Night 1', startsAt: NIGHT_1_DOORS, opensAt: NIGHT_1_DOORS, closesAt: NIGHT_1_CLOSE}];
    const shared = {eventId: EVENT_ID, issuedAt: Math.floor(ISSUE_MS / 1000), expiresAt: EXPIRES + 86400, sessions, keys: [{kid: signer.keyId, jwk: signer.publicKeyJwk}]};

    const old = await Manifest.buildManifest({...shared, version: 3}, publisher.privateKey);
    const replayed = await Manifest.verifyManifest(old.document, {publisher: publisher.publicKeyJwk}, {now: NIGHT_1_SCAN, installedVersion: 7});
    assert.equal(replayed.status, 'stale');
  });

  test('a manifest cannot introduce its own trust anchor', async () => {
    const attacker = await Payload.generateSigningKeyPair();
    const forged = await Manifest.buildManifest({
      eventId: EVENT_ID, version: 1, issuedAt: Math.floor(ISSUE_MS / 1000), expiresAt: EXPIRES + 86400,
      sessions: [{id: 'night-1', label: 'Night 1', startsAt: NIGHT_1_DOORS, opensAt: NIGHT_1_DOORS, closesAt: NIGHT_1_CLOSE}],
      keys: [{kid: attacker.keyId, jwk: attacker.publicKeyJwk}]
    }, attacker.privateKey);

    /* Signed by the very key it advertises - still refused, because trust
       comes from the pinned publisher set, not from the document. */
    const result = await Manifest.verifyManifest(forged.document, {[attacker.keyId]: attacker.publicKeyJwk}, {now: NIGHT_1_SCAN});
    assert.equal(result.status, 'valid', 'sanity: it verifies when that key IS pinned');

    const pinnedElsewhere = await Payload.generateSigningKeyPair();
    const refused = await Manifest.verifyManifest(forged.document, {publisher: pinnedElsewhere.publicKeyJwk}, {now: NIGHT_1_SCAN});
    assert.equal(refused.status, 'bad_signature');
  });

  test('a manifest that rejects private key material', async () => {
    const signer = await Payload.generateSigningKeyPair();
    const privateJwk = await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify'])).privateKey);
    assert.rejects(() => Manifest.buildManifest({
      eventId: EVENT_ID, version: 1, issuedAt: 1, expiresAt: 2,
      sessions: [{id: 'night-1', startsAt: 1, opensAt: 1, closesAt: 2}],
      keys: [{kid: signer.keyId, jwk: privateJwk}]
    }, signer.privateKey), /private material/);
  });

  test('a high-S manifest signature twin is rejected', async () => {
    const world = await buildWorld();
    const high = forceSignatureForm(world.document, true);
    const result = await Manifest.verifyManifest(
      high,
      {publisher: world.publisher.publicKeyJwk},
      {now: NIGHT_1_SCAN}
    );

    assert.equal(result.status, 'bad_signature');
    assert.match(result.reason, /low-S/);
  });

  test('manifest key ids must be derived from their public JWKs', async () => {
    const world = await buildWorld();
    const mismatched = {
      ...world.manifest,
      keys: [{kid: 'mismatched-kid', jwk: world.signer.publicKeyJwk}]
    };

    await assert.rejects(
      () => Manifest.buildManifest(mismatched, world.publisher.privateKey),
      /kid must be derived from its JWK/
    );

    const signed = await signManifestDocument(mismatched, world.publisher.privateKey);
    const verified = await Manifest.verifyManifest(
      signed,
      {publisher: world.publisher.publicKeyJwk},
      {now: NIGHT_1_SCAN}
    );
    assert.equal(verified.status, 'malformed');
    assert.match(verified.reason, /kid must be derived from its JWK/);
  });

  test('manifest ticket keys must import as P-256 verification keys', async () => {
    const world = await buildWorld();
    const invalidJwk = {...world.signer.publicKeyJwk, x: 'AA'};
    const kid = await Payload.keyIdFromJwk(invalidJwk);

    await assert.rejects(
      () => Manifest.buildManifest({
        ...world.manifest,
        keys: [{kid, jwk: invalidJwk}]
      }, world.publisher.privateKey),
      /imported as a P-256 verification key/
    );
  });
});

describe('conflicting offline devices', () => {
  test('two doors with no signal both admit, and reconciliation reports the conflict', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const payload = issued.payloads[0].payload;

    const front = scannerFor(world, 'door-front');
    const side = scannerFor(world, 'door-side');

    const a = await front.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    const b = await side.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN + 45});
    assert.equal(a.result, 'admitted');
    assert.equal(b.result, 'admitted', 'an offline device cannot see another device log');
    assert.match(a.scanId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(a.scanId, b.scanId, 'each physical scan attempt needs a stable unique identity');

    const reconciled = Scanner.reconcileRedemptions([front.pendingBatch(), side.pendingBatch()]);
    assert.equal(reconciled.admitted.length, 1);
    assert.equal(reconciled.admitted[0].deviceId, 'door-front', 'earliest scan wins');
    assert.equal(reconciled.conflicts.length, 1);
    assert.equal(reconciled.conflicts[0].alsoAdmittedBy, 'door-side');
    assert.equal(reconciled.conflicts[0].sameDevice, false);
  });

  test('retrying an identical offline batch is idempotent', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const door = scannerFor(world, 'door-front');
    await door.evaluate(issued.payloads[0].payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});

    const batch = door.pendingBatch();
    const reconciled = Scanner.reconcileRedemptions([batch, batch]);
    assert.equal(reconciled.admitted.length, 1);
    assert.equal(reconciled.conflicts.length, 0, 'a network retry is not a second physical admission');
  });

  test('conflicting records sharing one scanId are rejected', () => {
    const scanId = crypto.randomUUID();
    const ticketId = Issuer.newOpaqueId(ISSUE_MS);
    const first = {
      scanId, deviceId: 'door-front', eventId: EVENT_ID, sessionId: 'night-1',
      ticketId, manifestVersion: 1, scannedAt: NIGHT_1_SCAN, result: 'admitted'
    };
    const changed = {...first, sessionId: 'night-2'};

    assert.throws(
      () => Scanner.reconcileRedemptions([[first], [changed]]),
      /conflicting records share scanId/
    );
  });

  test('reconciliation is deterministic regardless of sync order', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const payload = issued.payloads[0].payload;

    const front = scannerFor(world, 'door-front');
    const side = scannerFor(world, 'door-side');
    /* Identical timestamps: the tie-break must still be stable. */
    await front.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    await side.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});

    const forward = Scanner.reconcileRedemptions([front.pendingBatch(), side.pendingBatch()]);
    const backward = Scanner.reconcileRedemptions([side.pendingBatch(), front.pendingBatch()]);
    assert.deepEqual(
      forward.admitted.map((entry) => entry.deviceId),
      backward.admitted.map((entry) => entry.deviceId)
    );
    assert.equal(forward.conflicts.length, backward.conflicts.length);
  });

  test('a combo ticket across two nights is not a conflict', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const payload = issued.payloads[0].payload;
    const door = scannerFor(world, 'door-front');

    await door.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    await door.evaluate(payload, {sessionId: 'night-2', now: NIGHT_2_SCAN});

    const reconciled = Scanner.reconcileRedemptions([door.pendingBatch()]);
    assert.equal(reconciled.admitted.length, 2);
    assert.equal(reconciled.conflicts.length, 0);
  });

  test('rejected scans are carried to the server for audit', async () => {
    const world = await buildWorld();
    const door = scannerFor(world, 'door-front');
    await door.evaluate('NT1.notarealpayload.zzz', {sessionId: 'night-1', now: NIGHT_1_SCAN});

    const reconciled = Scanner.reconcileRedemptions([door.pendingBatch()]);
    assert.equal(reconciled.admitted.length, 0);
    assert.equal(reconciled.rejected.length, 1);
    assert.equal(reconciled.rejected[0].result, 'bad_signature');
  });

  test('a device restored mid-show keeps its duplicate detection', async () => {
    const world = await buildWorld();
    const issued = await issueOne(world);
    const payload = issued.payloads[0].payload;

    const before = scannerFor(world, 'door-front');
    await before.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    const saved = before.pendingBatch();
    const savedScanId = saved[0].scanId;

    const after = scannerFor(world, 'door-front');
    after.restore(saved);
    const decision = await after.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN + 120});
    assert.equal(decision.result, 'duplicate', 'a reopened scanner must not forget admissions');
    assert.equal(after.pendingBatch()[0].scanId, savedScanId, 'restore must preserve the original scan identity');
  });

  test('installing a newer manifest mid-show keeps earlier admissions', async () => {
    /* A revocation or transfer publishes manifest v2 while doors are open.
       The device that installs it must still know who it admitted under v1,
       otherwise the same ticket walks in twice at the same door. */
    const world = await buildWorld();
    const issued = await issueOne(world);
    const payload = issued.payloads[0].payload;

    const underV1 = scannerFor(world, 'door-front');
    const first = await underV1.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN});
    assert.equal(first.result, 'admitted');
    assert.equal(first.manifestVersion, 1);
    const queue = underV1.pendingBatch();

    const refreshed = await Manifest.buildManifest({
      eventId: EVENT_ID,
      version: 2,
      issuedAt: NIGHT_1_SCAN,
      expiresAt: EXPIRES + 86400,
      timeZone: 'America/New_York',
      title: 'AfterBreak 2026',
      sessions: world.manifest.sessions,
      keys: world.manifest.keys,
      revoked: [Issuer.newOpaqueId(ISSUE_MS)],
      minSerials: {}
    }, world.publisher.privateKey);
    const verified = await Manifest.verifyManifest(refreshed.document, {publisher: world.publisher.publicKeyJwk}, {now: NIGHT_1_SCAN, installedVersion: 1});
    assert.equal(verified.status, 'valid');
    assert.equal(verified.manifest.version, 2);

    const underV2 = Scanner.createScanner({manifest: verified.manifest, deviceId: 'door-front'});
    underV2.restore(queue.filter((entry) => entry.eventId === verified.manifest.eventId));
    assert.equal(underV2.admittedCount(), 1, 'the v1 admission must survive the manifest refresh');
    const again = await underV2.evaluate(payload, {sessionId: 'night-1', now: NIGHT_1_SCAN + 300});
    assert.equal(again.result, 'duplicate', 'a manifest refresh must not reopen the door for an admitted ticket');
    assert.equal(again.manifestVersion, 2);
  });
});

describe('persistent schema', () => {
  test('issued records satisfy full catalog referential integrity', async () => {
    const world = await buildWorld();
    const offerRecord = offer('combo-early-bird', ['night-1', 'night-2'], 4000);
    const orderRecord = order(offerRecord, 2);
    const issued = await Issuer.issueTickets({
      order: orderRecord, offer: offerRecord,
      keyId: world.signer.keyId, privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS, expiresAt: EXPIRES
    });

    const catalog = Schema.validateCatalog({
      events: [{
        id: EVENT_ID, slug: 'afterbreak-2026', title: 'AfterBreak 2026', venue: 'Philadelphia',
        timeZone: 'America/New_York', startsAt: '2026-09-11T22:00:00-04:00', endsAt: '2026-09-13T04:00:00-04:00',
        status: 'onsale', promoterId: 'no-nonsense'
      }],
      sessions: [
        {id: 'night-1', eventId: EVENT_ID, label: 'Night 1', startsAt: '2026-09-11T23:45:00-04:00', status: 'scheduled'},
        {id: 'night-2', eventId: EVENT_ID, label: 'Night 2', startsAt: '2026-09-12T23:45:00-04:00', status: 'scheduled'}
      ],
      offers: [offerRecord],
      orders: [orderRecord],
      tickets: issued.tickets,
      entitlements: issued.entitlements
    });

    assert.equal(catalog.tickets.length, 2, 'quantity 2 issues two tickets');
    assert.equal(catalog.entitlements.length, 4, 'each combo ticket grants both nights');
  });

  test('the catalog refuses a second admitted redemption for one session', async () => {
    const world = await buildWorld();
    const offerRecord = offer('ga-night-1', ['night-1'], 2500);
    const orderRecord = order(offerRecord);
    const issued = await Issuer.issueTickets({
      order: orderRecord, offer: offerRecord,
      keyId: world.signer.keyId, privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS, expiresAt: EXPIRES
    });
    const ticketId = issued.tickets[0].id;

    const redemption = (id) => ({
      id, scanId: crypto.randomUUID(), ticketId, sessionId: 'night-1', eventId: EVENT_ID, deviceId: 'door-front',
      result: 'admitted', scannedAt: new Date(NIGHT_1_SCAN * 1000).toISOString(), manifestVersion: 1
    });

    const catalog = {
      events: [{
        id: EVENT_ID, slug: 'afterbreak-2026', title: 'AfterBreak 2026', venue: 'Philadelphia',
        timeZone: 'America/New_York', startsAt: '2026-09-11T22:00:00-04:00', endsAt: '2026-09-13T04:00:00-04:00',
        status: 'onsale', promoterId: 'no-nonsense'
      }],
      sessions: [{id: 'night-1', eventId: EVENT_ID, label: 'Night 1', startsAt: '2026-09-11T23:45:00-04:00', status: 'scheduled'}],
      offers: [offerRecord], orders: [orderRecord],
      tickets: issued.tickets, entitlements: issued.entitlements,
      devices: [{
        id: 'door-front', eventId: EVENT_ID, label: 'Front door', status: 'active',
        manifestVersion: 1, enrolledAt: new Date(ISSUE_MS).toISOString()
      }],
      redemptions: [redemption(Issuer.newOpaqueId(ISSUE_MS)), redemption(Issuer.newOpaqueId(ISSUE_MS + 1))]
    };

    assert.throws(() => Schema.validateCatalog(catalog), /at most one admitted redemption/);
  });

  test('the catalog enforces redemption identity and event ownership', async () => {
    const world = await buildWorld();
    const offerRecord = offer('ga-night-1', ['night-1'], 2500);
    const orderRecord = order(offerRecord);
    const issued = await Issuer.issueTickets({
      order: orderRecord, offer: offerRecord,
      keyId: world.signer.keyId, privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS, expiresAt: EXPIRES
    });
    const ticketId = issued.tickets[0].id;
    const event = {
      id: EVENT_ID, slug: 'afterbreak-2026', title: 'AfterBreak 2026', venue: 'Philadelphia',
      timeZone: 'America/New_York', startsAt: '2026-09-11T22:00:00-04:00', endsAt: '2026-09-13T04:00:00-04:00',
      status: 'onsale', promoterId: 'no-nonsense'
    };
    const otherEvent = {...event, id: 'other-event', slug: 'other-event', title: 'Other Event'};
    const sessions = [
      {id: 'night-1', eventId: EVENT_ID, label: 'Night 1', startsAt: '2026-09-11T23:45:00-04:00', status: 'scheduled'},
      {id: 'other-session', eventId: 'other-event', label: 'Other Session', startsAt: '2026-09-11T23:45:00-04:00', status: 'scheduled'}
    ];
    const devices = [
      {id: 'door-front', eventId: EVENT_ID, label: 'Front door', status: 'active', manifestVersion: 1, enrolledAt: new Date(ISSUE_MS).toISOString()},
      {id: 'door-other', eventId: 'other-event', label: 'Other door', status: 'active', manifestVersion: 1, enrolledAt: new Date(ISSUE_MS).toISOString()}
    ];
    const redemption = (overrides = {}) => ({
      id: Issuer.newOpaqueId(ISSUE_MS + 10),
      scanId: crypto.randomUUID(),
      ticketId,
      sessionId: 'night-1',
      eventId: EVENT_ID,
      deviceId: 'door-front',
      result: 'duplicate',
      scannedAt: new Date(NIGHT_1_SCAN * 1000).toISOString(),
      manifestVersion: 1,
      ...overrides
    });
    const catalog = (redemptions) => ({
      events: [event, otherEvent], sessions, offers: [offerRecord], orders: [orderRecord],
      tickets: issued.tickets, entitlements: issued.entitlements, devices, redemptions
    });

    const first = redemption();
    assert.throws(
      () => Schema.validateCatalog(catalog([first, redemption({id: first.id})])),
      /redemption ids must be unique/
    );
    assert.throws(
      () => Schema.validateCatalog(catalog([first, redemption({scanId: first.scanId})])),
      /scanIds must be unique/
    );
    assert.throws(
      () => Schema.validateCatalog(catalog([redemption({deviceId: 'missing-door'})])),
      /unknown device/
    );
    assert.throws(
      () => Schema.validateCatalog(catalog([redemption({sessionId: 'other-session'})])),
      /mixes session and event/
    );
    assert.throws(
      () => Schema.validateCatalog(catalog([redemption({deviceId: 'door-other'})])),
      /mixes device and event/
    );
  });

  test('money is integer cents and totals must reconcile', () => {
    assert.throws(() => Schema.validateOfferRecord(offer('bad', ['night-1'], 29.77)), /integer of cents/);
  });

  test('an unpaid order cannot be issued', async () => {
    const world = await buildWorld();
    const offerRecord = offer('ga-night-1', ['night-1'], 2500);
    await assert.rejects(() => Issuer.issueTickets({
      order: {...order(offerRecord), status: 'pending'},
      offer: offerRecord,
      keyId: world.signer.keyId, privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS, expiresAt: EXPIRES
    }), /paid order/);
  });

  test('a paid order with an incorrect total cannot be issued', async () => {
    const world = await buildWorld();
    const offerRecord = offer('ga-night-1', ['night-1'], 2500);
    await assert.rejects(() => Issuer.issueTickets({
      order: {...order(offerRecord), totalCents: 0},
      offer: offerRecord,
      keyId: world.signer.keyId, privateKey: world.signer.privateKey,
      nowMs: ISSUE_MS, expiresAt: EXPIRES
    }), /totalCents/);
  });

  test('ticket identifiers are unguessable and unique', () => {
    const ids = new Set();
    for (let index = 0; index < 500; index += 1) ids.add(Issuer.newOpaqueId(ISSUE_MS));
    assert.equal(ids.size, 500, 'identifiers minted in the same millisecond must not collide');
    ids.forEach((id) => assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/));
  });
});

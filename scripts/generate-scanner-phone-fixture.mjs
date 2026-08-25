#!/usr/bin/env node
/**
 * Generate the disposable kit for the physical-phone scanner qualification
 * described in docs/testing/scanner-phone-matrix.md.
 *
 *   npm run scanner:fixture
 *
 * The kit is public-only by construction. Two key pairs are generated in
 * memory: a publisher key that signs the manifest, and a ticket key whose
 * public JWK travels inside that manifest. Only public JWKs and signed
 * documents are ever written to disk, so the kit can be copied onto a phone,
 * mailed to a tester, or pasted into a bug report without leaking a signing
 * key. The private CryptoKeys are never exported and die with the process.
 *
 * The kit is deliberately short lived (seven days) and uses its own event id,
 * so a qualification credential can never be mistaken for a real ticket at a
 * live door.
 */

import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = new URL('../src/', import.meta.url);

const DAY_SECONDS = 24 * 60 * 60;
const KIT_LIFETIME_SECONDS = 7 * DAY_SECONDS;
const EVENT_ID = 'scanner-qualification';
const QR_SCALE = 8;
const QR_QUIET_ZONE = 4;
const SVG_LABEL = 'Scanner qualification combo ticket';
const COMMAND = 'npm run scanner:fixture';

function parseArguments(argv) {
  const options = {out: join(ROOT, 'src', 'scanner', 'fixtures', 'generated'), nowMs: Date.now()};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--out') {
      if (!value) throw new Error('--out needs a directory path.');
      options.out = resolve(value);
      index += 1;
    } else if (flag === '--now') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--now needs epoch milliseconds.');
      options.nowMs = parsed;
      index += 1;
    } else {
      throw new Error('Unknown argument: ' + flag);
    }
  }
  return options;
}

async function loadModules() {
  for (const name of ['ticket-schema.js', 'ticket-payload.js', 'ticket-manifest.js', 'ticket-issuer.js', 'qr-encode.js']) {
    await import(new URL(name, SOURCE).href);
  }
  return {
    Payload: globalThis.NonsenseTicketPayload,
    Manifest: globalThis.NonsenseTicketManifest,
    Issuer: globalThis.NonsenseTicketIssuer,
    QR: globalThis.NonsenseQR
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Fails loudly rather than writing a kit that leaks a signing key. */
function assertNoPrivateMaterial(value, path) {
  if (!value || typeof value !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(value, 'd')) {
    throw new Error('Refusing to write private key material at ' + path + '.');
  }
  Object.entries(value).forEach(([key, entry]) => assertNoPrivateMaterial(entry, path + '.' + key));
}

function displayPage(fixture) {
  const enrollment = JSON.stringify(fixture.publisherPublicJwk);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scanner qualification ticket</title>
<style>
  body{margin:0;background:#fff;color:#17141f;
       font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
       padding:16px;max-width:680px;margin:0 auto}
  h1{font-size:14px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 4px}
  p.lede{margin:0 0 16px;color:#5c5867;font-size:12px}
  figure{margin:0 0 18px;text-align:center}
  img{width:100%;max-width:420px;height:auto;image-rendering:pixelated;background:#fff}
  figcaption{font-size:11px;color:#5c5867;margin-top:8px}
  h2{font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin:18px 0 6px}
  pre{border:2px solid #17141f;padding:10px;white-space:pre-wrap;word-break:break-all;
      font-size:11px;background:#fbf9f4;margin:0}
  dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12px;margin:0}
  dt{color:#5c5867}
  .warn{border:2px solid #b3261e;color:#b3261e;padding:10px;font-size:12px;margin:18px 0 0}
</style>
</head>
<body>
<h1>Scanner qualification ticket</h1>
<p class="lede">Display this page on the ticket phone. Scan it with the door scanner on the other phone.</p>

<figure>
  <img src="./ticket.svg" alt="Signed combo ticket QR code for scanner qualification">
  <figcaption>Combo ticket &middot; Night 1 + Night 2 &middot; QR version ${fixture.qr.version}, level M, ${fixture.qr.pixelWidth}&times;${fixture.qr.pixelHeight} px</figcaption>
</figure>

<dl>
  <dt>Fixture SHA-256</dt><dd>${escapeHtml(fixture.sha256)}</dd>
  <dt>Event ID</dt><dd>${escapeHtml(fixture.eventId)}</dd>
  <dt>Manifest version</dt><dd>${fixture.manifestVersion}</dd>
  <dt>Ticket key kid</dt><dd>${escapeHtml(fixture.ticketKeyId)}</dd>
  <dt>Combo ticket ID</dt><dd>${escapeHtml(fixture.comboTicketId)}</dd>
  <dt>Expires</dt><dd>${escapeHtml(fixture.expiresAtIso)}</dd>
</dl>

<h2>1 &middot; Publisher public key (paste into the scanner)</h2>
<pre>${escapeHtml(enrollment)}</pre>

<h2>2 &middot; Signed manifest document (paste into the scanner)</h2>
<pre>${escapeHtml(fixture.manifestDocument)}</pre>

<h2>3 &middot; Signed NT1 ticket payload (the exact text the QR encodes)</h2>
<pre>${escapeHtml(fixture.ticketPayload)}</pre>

<p class="warn">
  Qualification kit only. It carries no private key, expires ${escapeHtml(fixture.expiresAtIso)},
  and uses the event id <strong>${escapeHtml(fixture.eventId)}</strong> so it can never admit
  anyone at a real door.
</p>
</body>
</html>
`;
}

function evidenceNote(fixture) {
  return `# Scanner qualification evidence

Generated ${fixture.generatedAtIso} by \`${COMMAND}\`.
Expires ${fixture.expiresAtIso}. Regenerate after that and re-record the table.

Copy these into the **Test corpus** table of
\`docs/testing/scanner-phone-matrix.md\`:

| Field | Value |
| --- | --- |
| Fixture-generation command | \`${COMMAND}\` |
| Fixture SHA-256 | \`${fixture.sha256}\` |
| Event ID | \`${fixture.eventId}\` |
| Manifest version | ${fixture.manifestVersion} |
| Ticket-key \`kid\` | \`${fixture.ticketKeyId}\` |
| Combo ticket ID | \`${fixture.comboTicketId}\` |
| QR rendered width × height | ${fixture.qr.pixelWidth} × ${fixture.qr.pixelHeight} px |
| QR error-correction level | M |

QR symbol: version ${fixture.qr.version}, ${fixture.qr.modules} × ${fixture.qr.modules} modules,
mask ${fixture.qr.mask}, quiet zone ${QR_QUIET_ZONE} modules, scale ${QR_SCALE} px per module.
Encoded document length: ${fixture.ticketPayload.length} characters.

## Sessions in this kit

Both door windows stay open for the life of the kit, so the combo-admission
table can be exercised in one sitting by changing only the scanner's selected
session.

${fixture.sessions.map((session) => '- `' + session.id + '` (' + session.label + ') open ' + session.opensAtIso + ' → ' + session.closesAtIso).join('\n')}

## Expected results

- First scan on \`night-1\`: **ADMIT**. Second scan on \`night-1\`: **ALREADY IN**.
- First scan on \`night-2\`: **ADMIT**. Second scan on \`night-2\`: **ALREADY IN**.
- Any decode that yields text other than the NT1 document above is a category 3
  failure in the triage list and implicates QR rendering.

## Handling

This kit contains only public JWKs and signed documents. It is safe to copy onto
a phone or attach to a bug report. If a private key ever appears in these files,
treat it as a defect in \`scripts/generate-scanner-phone-fixture.mjs\` and rotate
the key.
`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const {Payload, Manifest, Issuer, QR} = await loadModules();

  const nowSeconds = Math.floor(options.nowMs / 1000);
  const expiresAt = nowSeconds + KIT_LIFETIME_SECONDS;
  /* Windows open slightly in the past so a freshly generated kit is
     immediately scannable rather than reporting DOORS CLOSED. */
  const opensAt = nowSeconds - 3600;

  const publisher = await Payload.generateSigningKeyPair();
  const ticketSigner = await Payload.generateSigningKeyPair();

  const sessions = [
    {id: 'night-1', label: 'Night 1', startsAt: nowSeconds, opensAt, closesAt: expiresAt},
    {id: 'night-2', label: 'Night 2', startsAt: nowSeconds + DAY_SECONDS, opensAt, closesAt: expiresAt}
  ];

  const built = await Manifest.buildManifest({
    eventId: EVENT_ID,
    version: 1,
    issuedAt: nowSeconds,
    expiresAt,
    timeZone: 'America/New_York',
    title: 'Scanner qualification kit',
    sessions,
    keys: [{kid: ticketSigner.keyId, jwk: ticketSigner.publicKeyJwk}]
  }, publisher.privateKey);

  const comboTicketId = Issuer.newOpaqueId(options.nowMs);
  const ticketPayload = await Payload.encodeTicketPayload({
    keyId: ticketSigner.keyId,
    eventId: EVENT_ID,
    ticketId: comboTicketId,
    sessionIds: ['night-1', 'night-2'],
    serial: 1,
    issuedAt: nowSeconds,
    expiresAt
  }, ticketSigner.privateKey);

  /* Verify the kit against its own trust anchor before writing it. A fixture
     that does not verify would send a tester chasing a phantom camera fault. */
  const manifestCheck = await Manifest.verifyManifest(
    built.document,
    {publisher: publisher.publicKeyJwk},
    {now: nowSeconds}
  );
  if (manifestCheck.status !== 'valid') {
    throw new Error('Generated manifest failed self-verification: ' + manifestCheck.status);
  }
  const ticketCheck = await Payload.verifyTicketPayload(
    ticketPayload,
    Manifest.ticketKeysFromManifest(manifestCheck.manifest),
    {now: nowSeconds}
  );
  if (ticketCheck.status !== 'valid') {
    throw new Error('Generated ticket failed self-verification: ' + ticketCheck.status);
  }

  const symbol = QR.encode(ticketPayload);
  const svg = QR.toSvg(symbol, {scale: QR_SCALE, quietZone: QR_QUIET_ZONE, label: SVG_LABEL});
  const pixelExtent = (symbol.size + QR_QUIET_ZONE * 2) * QR_SCALE;

  const iso = (seconds) => new Date(seconds * 1000).toISOString();

  const body = {
    kind: 'nonsense-scanner-qualification-kit',
    command: COMMAND,
    eventId: EVENT_ID,
    generatedAtEpochSeconds: nowSeconds,
    generatedAtIso: iso(nowSeconds),
    expiresAtEpochSeconds: expiresAt,
    expiresAtIso: iso(expiresAt),
    manifestVersion: manifestCheck.manifest.version,
    ticketKeyId: ticketSigner.keyId,
    comboTicketId,
    publisherPublicJwk: publisher.publicKeyJwk,
    ticketPublicJwk: ticketSigner.publicKeyJwk,
    manifestDocument: built.document,
    ticketPayload,
    sessions: sessions.map((session) => ({
      id: session.id,
      label: session.label,
      opensAtIso: iso(session.opensAt),
      closesAtIso: iso(session.closesAt)
    })),
    qr: {
      version: symbol.version,
      mask: symbol.mask,
      modules: symbol.size,
      quietZoneModules: QR_QUIET_ZONE,
      scale: QR_SCALE,
      pixelWidth: pixelExtent,
      pixelHeight: pixelExtent,
      errorCorrectionLevel: 'M'
    }
  };

  assertNoPrivateMaterial(body, 'fixture');

  /* The digest covers the kit body, so the field cannot include itself. It is
     the immutable identifier a tester records alongside their results. */
  const sha256 = createHash('sha256').update(Manifest.canonicalJson(body), 'utf8').digest('hex');
  const fixture = {...body, sha256};

  const html = displayPage(fixture);
  if (/&quot;d&quot;\s*:/.test(html) || /"d"\s*:/.test(html)) {
    throw new Error('Refusing to write a display page containing private key material.');
  }

  await mkdir(options.out, {recursive: true});
  await writeFile(join(options.out, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  await writeFile(join(options.out, 'ticket.svg'), svg, 'utf8');
  await writeFile(join(options.out, 'index.html'), html, 'utf8');
  await writeFile(join(options.out, 'evidence.md'), evidenceNote(fixture), 'utf8');

  process.stdout.write(JSON.stringify({
    command: COMMAND,
    outputDirectory: options.out,
    fixtureSha256: sha256,
    eventId: EVENT_ID,
    manifestVersion: fixture.manifestVersion,
    ticketKeyId: fixture.ticketKeyId,
    comboTicketId,
    expiresAtIso: fixture.expiresAtIso,
    files: ['fixture.json', 'index.html', 'ticket.svg', 'evidence.md']
  }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile, rm, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {describe, test} from 'node:test';

await import('../src/ticket-payload.js');
await import('../src/ticket-manifest.js');

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GENERATOR = join(ROOT, 'scripts', 'generate-scanner-phone-fixture.mjs');
const FIXED_NOW_MS = 1787587200000;

function containsPrivateJwk(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, 'd')) return true;
  return Object.values(value).some(containsPrivateJwk);
}

describe('physical-phone qualification fixture', () => {
  test('provides one reproducible npm command', async () => {
    const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts['scanner:fixture'], 'node scripts/generate-scanner-phone-fixture.mjs');
  });

  test('generates a fresh qualification kit inside the Pages deployment', async () => {
    const workflow = await readFile(join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
    const deployJob = workflow.slice(workflow.indexOf('  deploy:'));
    const setupNode = deployJob.indexOf('uses: actions/setup-node@');
    const generateFixture = deployJob.indexOf('run: npm run scanner:fixture');
    const uploadSite = deployJob.indexOf('uses: actions/upload-pages-artifact@');

    assert.ok(setupNode >= 0, 'the deploy job must provide the Node runtime used by the generator');
    assert.ok(generateFixture > setupNode, 'the fixture must be generated after Node setup');
    assert.ok(uploadSite > generateFixture, 'the generated fixture must exist before src is uploaded');
  });

  test('generates a public-only signed combo-ticket kit', async (context) => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'nonsense-scanner-fixture-'));
    context.after(() => rm(outputDirectory, {recursive: true, force: true}));

    const {stdout} = await execFileAsync(process.execPath, [
      GENERATOR,
      '--out', outputDirectory,
      '--now', String(FIXED_NOW_MS)
    ], {cwd: ROOT});
    const report = JSON.parse(stdout);

    const fixtureText = await readFile(join(outputDirectory, 'fixture.json'), 'utf8');
    const fixture = JSON.parse(fixtureText);
    const html = await readFile(join(outputDirectory, 'index.html'), 'utf8');
    const svg = await readFile(join(outputDirectory, 'ticket.svg'), 'utf8');
    const evidence = await readFile(join(outputDirectory, 'evidence.md'), 'utf8');

    assert.equal(report.command, 'npm run scanner:fixture');
    assert.equal(report.fixtureSha256, fixture.sha256);
    assert.equal(containsPrivateJwk(fixture), false, 'fixture JSON must never serialize a private JWK');
    assert.doesNotMatch(html, /&quot;d&quot;\s*:/, 'display page must never serialize a private JWK');

    const manifestResult = await globalThis.NonsenseTicketManifest.verifyManifest(
      fixture.manifestDocument,
      {publisher: fixture.publisherPublicJwk},
      {now: fixture.generatedAtEpochSeconds}
    );
    assert.equal(manifestResult.status, 'valid');

    const ticketResult = await globalThis.NonsenseTicketPayload.verifyTicketPayload(
      fixture.ticketPayload,
      globalThis.NonsenseTicketManifest.ticketKeysFromManifest(manifestResult.manifest),
      {now: fixture.generatedAtEpochSeconds}
    );
    assert.equal(ticketResult.status, 'valid');
    assert.deepEqual(ticketResult.claims.sessionIds, ['night-1', 'night-2']);
    assert.equal(ticketResult.claims.ticketId, fixture.comboTicketId);

    assert.match(svg, /^<svg[^>]+aria-label="Scanner qualification combo ticket"/);
    assert.ok(html.includes(fixture.ticketPayload), 'display page must expose the exact signed payload');
    assert.ok(html.includes('./ticket.svg'), 'display page must render the generated QR');
    assert.ok(evidence.includes(fixture.sha256));
    assert.ok(evidence.includes(fixture.comboTicketId));
  });
});

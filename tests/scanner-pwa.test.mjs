import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {describe, test} from 'node:test';

const root = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), 'utf8');
}

describe('offline scanner decoder assets', () => {
  test('pins and vendors jsQR with its license', () => {
    const packageJson = JSON.parse(read('package.json'));
    /* Pinned as a vendoring input, not a runtime import: the door PWA loads
       src/scanner/vendor/jsQR.js, and no test imports the npm package, so CI
       stays green with no install step. */
    assert.equal(packageJson.devDependencies?.jsqr, '1.4.0');
    assert.equal(packageJson.dependencies, undefined, 'the shipped site must have no runtime dependencies');
    assert.equal(existsSync(new URL('src/scanner/vendor/jsQR.js', root)), true);
    assert.equal(existsSync(new URL('src/scanner/vendor/jsQR.LICENSE.txt', root)), true);

    const vendor = read('src/scanner/vendor/jsQR.js');
    const license = read('src/scanner/vendor/jsQR.LICENSE.txt');
    assert.match(vendor, /jsQR/);
    assert.doesNotMatch(vendor, /<script[^>]+https?:\/\//i);
    assert.match(license, /Apache License[\s\S]+Version 2\.0/);
  });

  test('loads and precaches every decoder locally in dependency order', () => {
    const html = read('src/scanner/index.html');
    const worker = read('src/scanner/sw.js');
    const vendor = html.indexOf('<script src="./vendor/jsQR.js"></script>');
    const adapter = html.indexOf('<script src="./qr-decoder.js"></script>');
    const app = html.indexOf('<script src="./scanner-app.js"></script>');

    assert.ok(vendor >= 0, 'scanner must load the local jsQR browser asset');
    assert.ok(adapter > vendor, 'decoder adapter must load after jsQR');
    assert.ok(app > adapter, 'scanner app must load after the decoder adapter');
    assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
    assert.match(worker, /const CACHE = 'nonsense-door-v2'/);
    assert.match(worker, /'\.\/vendor\/jsQR\.js'/);
    assert.match(worker, /'\.\/qr-decoder\.js'/);
  });

  test('restores the local admission log by event, not by manifest version', () => {
    /* scanner-core proves a restored log keeps duplicate detection; the shell
       must hand it every scan for this event, including scans recorded under
       an earlier manifest, or a mid-show manifest refresh forgets who is in. */
    const app = read('src/scanner/scanner-app.js');
    assert.match(app, /scanner\.restore\(loadQueue\(\)\.filter\(\(entry\) => entry\.eventId === manifest\.eventId\)\)/);
    assert.doesNotMatch(app, /entry\.manifestVersion === manifest\.version/);
  });

  test('routes camera frames through the decoder adapter and keeps manual entry', () => {
    const app = read('src/scanner/scanner-app.js');
    assert.match(app, /NonsenseQrDecoder\.createDecoder\(/);
    assert.match(app, /decoder\.decode\(el\.video\)/);
    assert.doesNotMatch(app, /new root\.BarcodeDetector/);
    assert.doesNotMatch(app, /typeof root\.BarcodeDetector === 'undefined'/);
    assert.match(app, /\$\('\[data-check\]'\)\.addEventListener/);
  });
});

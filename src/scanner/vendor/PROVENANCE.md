# Vendored decoder provenance

| Field | Value |
| --- | --- |
| Package | `jsqr` |
| Version | 1.4.0 |
| License | Apache-2.0 (`jsQR.LICENSE.txt`) |
| File | `jsQR.js` (UMD browser bundle) |

## Why it is vendored

The door scanner must boot with no network. Everything it needs is served from
this repository, so `index.html` loads `./vendor/jsQR.js` directly and the
service worker precaches it. Nothing fetches a CDN.

`jsqr` is pinned in `devDependencies` only to record which upstream release this
file came from. No runtime code imports the npm package, and `npm test` does not
need `node_modules` — which is what lets CI run `npm test` with no install step.

## Re-vendoring

```bash
npm install                       # resolves the pinned 1.4.0
cp node_modules/jsqr/dist/jsQR.js src/scanner/vendor/jsQR.js
```

Then bump `CACHE` in `src/scanner/sw.js` so door devices replace the cached
shell instead of running a half-updated mix of files, and re-run `npm test`:
`tests/qr-roundtrip.test.mjs` decodes this exact file, so a bad copy fails there.

# Scanner jsQR Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current QR encoder while making the offline scanner decode exact signed NT1 tickets on browsers without `BarcodeDetector`, with reproducible optical regression tests and a measurable physical-phone gate.

**Architecture:** Add a small decoder adapter that prefers native `BarcodeDetector` and falls back to a pinned, vendored `jsQR` browser asset using a reusable canvas. Keep decoded strings outside the trust boundary until the existing ticket verifier and scanner core accept them. Test the retained encoder by rasterizing its real module matrix and decoding the complete signed document with the independent `jsQR` implementation.

**Tech Stack:** Browser JavaScript IIFEs, Node.js ESM and `node:test`, WebCrypto P-256, `jsqr@1.4.0`, service-worker Cache API.

**Repository constraint:** Work in the existing shared dirty worktree, preserve unrelated changes, and do not stage or commit unless separately requested.

---

### Task 1: Pin and vendor jsQR for offline use

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `src/scanner/vendor/jsQR.js`
- Create: `src/scanner/vendor/jsQR.LICENSE.txt`
- Test: `tests/scanner-pwa.test.mjs`

- [ ] **Step 1: Write the failing offline-asset contract**

Add assertions that `package.json` pins `jsqr` to exactly `1.4.0`, both vendored files exist, and the vendored JavaScript contains the upstream jsQR browser export rather than a CDN loader.

- [ ] **Step 2: Run the contract and verify RED**

Run: `node --test tests/scanner-pwa.test.mjs`

Expected: FAIL because `jsqr`, `src/scanner/vendor/jsQR.js`, and the vendor license do not exist.

- [ ] **Step 3: Install and vendor the pinned package**

Run: `npm install --save-exact jsqr@1.4.0`

Copy `node_modules/jsqr/dist/jsQR.js` byte-for-byte to `src/scanner/vendor/jsQR.js` and `node_modules/jsqr/LICENSE` to `src/scanner/vendor/jsQR.LICENSE.txt`. Do not edit the vendored source.

- [ ] **Step 4: Verify GREEN and dependency health**

Run: `node --test tests/scanner-pwa.test.mjs`

Run: `npm audit --omit=dev`

Expected: contract passes and the audit reports zero known production vulnerabilities.

### Task 2: Define and implement the decoder adapter

**Files:**
- Create: `src/scanner/qr-decoder.js`
- Create: `tests/scanner-decoder.test.mjs`

- [ ] **Step 1: Write failing native-selection tests**

Load `qr-decoder.js` with a fake `BarcodeDetector` whose `getSupportedFormats()` returns `['qr_code']`. Require `createDecoder()` to return `kind === 'native'` and `decode(frame)` to return the first detector result's exact `rawValue`.

- [ ] **Step 2: Verify native-selection RED**

Run: `node --test tests/scanner-decoder.test.mjs`

Expected: FAIL because `src/scanner/qr-decoder.js` does not exist.

- [ ] **Step 3: Implement the minimal native path**

Expose a frozen `globalThis.NonsenseQrDecoder` with one asynchronous `createDecoder(options)` function. Detect native QR support with `BarcodeDetector.getSupportedFormats()`, instantiate with `{formats: ['qr_code']}`, and return a decoder whose `decode(source)` returns the first exact `rawValue` or `null`.

- [ ] **Step 4: Verify native-selection GREEN**

Run: `node --test tests/scanner-decoder.test.mjs`

Expected: native-selection tests pass.

- [ ] **Step 5: Write failing jsQR fallback tests**

Require fallback when native detection is missing, lacks `qr_code`, or throws during capability detection. Inject a fake canvas/context and fake `jsQR`; require the adapter to reuse the canvas, draw the frame, pass RGBA pixels and dimensions to `jsQR`, and return the exact decoded `data`. Require a clear rejection when neither decoder exists.

- [ ] **Step 6: Verify fallback RED**

Run: `node --test tests/scanner-decoder.test.mjs`

Expected: FAIL because only the native path exists.

- [ ] **Step 7: Implement the minimal fallback**

Create one canvas through an injectable `createCanvas` option or `document.createElement('canvas')`, request a `2d` context with `{willReadFrequently: true}`, resize it to `videoWidth`/`videoHeight`, draw the frame, and call `jsQR(image.data, width, height, {inversionAttempts: 'dontInvert'})`. Return `result.data` or `null` without parsing it.

- [ ] **Step 8: Verify adapter GREEN**

Run: `node --test tests/scanner-decoder.test.mjs`

Expected: all native, fallback, reuse, and unavailable-decoder tests pass.

### Task 3: Wire the adapter into the offline PWA

**Files:**
- Modify: `src/scanner/index.html`
- Modify: `src/scanner/scanner-app.js`
- Modify: `src/scanner/sw.js`
- Test: `tests/scanner-pwa.test.mjs`

- [ ] **Step 1: Write the failing shell-wiring contract**

Require script order `vendor/jsQR.js` → `qr-decoder.js` → `scanner-app.js`, require both new assets in the service-worker `SHELL`, require a cache version newer than `nonsense-door-v1`, and reject HTTP/CDN decoder URLs.

- [ ] **Step 2: Verify shell-wiring RED**

Run: `node --test tests/scanner-pwa.test.mjs`

Expected: FAIL because the shell does not load or cache either decoder asset.

- [ ] **Step 3: Update the shell and service worker**

Add the local scripts in dependency order, add both paths to `SHELL`, and change the cache key to `nonsense-door-v2`.

- [ ] **Step 4: Write the failing scanner-integration contract**

Require `scanner-app.js` to create a decoder through `NonsenseQrDecoder.createDecoder()`, decode camera frames through the returned adapter, retain manual entry, and remove the early return that rejects browsers solely because `BarcodeDetector` is missing.

- [ ] **Step 5: Verify scanner-integration RED**

Run: `node --test tests/scanner-pwa.test.mjs`

Expected: FAIL because `scanner-app.js` still directly constructs `BarcodeDetector`.

- [ ] **Step 6: Replace direct detector use with the adapter**

Create the decoder before requesting the camera, keep the existing secure-context and `getUserMedia` checks, show whether the native or jsQR decoder is active, and call `decoder.decode(video)` inside the existing animation loop. Preserve camera teardown, manual entry, debounce, queue persistence, and all admission behavior.

- [ ] **Step 7: Verify PWA wiring GREEN**

Run: `node --test tests/scanner-pwa.test.mjs tests/scanner-decoder.test.mjs`

Expected: all decoder and static-shell contracts pass.

### Task 4: Prove exact signed-ticket round trips

**Files:**
- Create: `tests/qr-roundtrip.test.mjs`

- [ ] **Step 1: Write the independent decode test**

Generate a WebCrypto P-256 key pair and real combo-ticket NT1 document. Encode it with `NonsenseQR`, rasterize the matrix into RGBA pixels with a four-module quiet zone, decode with the npm `jsqr` package, and assert byte-for-byte equality with the original NT1 document. Verify the decoded signature with `NonsenseTicketPayload.verifyTicketPayload()`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/qr-roundtrip.test.mjs`

Expected before Task 1: FAIL because `jsqr` is unavailable. If Task 1 is already complete, temporarily assert a deliberately wrong decoded document to demonstrate the test catches a mismatch, then restore the correct assertion before implementation proceeds.

- [ ] **Step 3: Add admission assertions**

Feed the exact decoded payload to scanners bound to Night 1 and Night 2 sessions. Require one admission for each granted session and duplicate rejection for a second attempt in the same session.

- [ ] **Step 4: Verify exact round-trip GREEN**

Run: `node --test tests/qr-roundtrip.test.mjs`

Expected: exact decode, signature verification, combo admission, and duplicate assertions pass.

### Task 5: Add optical regression cases and the physical test record

**Files:**
- Modify: `tests/qr-roundtrip.test.mjs`
- Create: `docs/testing/scanner-phone-matrix.md`

- [ ] **Step 1: Write failing transformed-raster cases**

Parameterize rasterization for module scale, dark/light luminance, and a bounded glare patch. Add named cases for high contrast, small modules, dim display, reduced contrast, and glare. Demonstrate RED once by setting one case's expected document to a sentinel value, then restore the exact NT1 expectation.

- [ ] **Step 2: Verify transformed-raster GREEN**

Run: `node --test tests/qr-roundtrip.test.mjs`

Expected: every raster condition independently decodes to the exact signed document.

- [ ] **Step 3: Create the physical-phone result sheet**

Transcribe the mandatory iPhone Safari and Android Chrome matrix from the approved design. Include ten attempt cells per condition, exact device/OS/browser fields, QR size, median decode time, observed admission result, offline reload result, and the 9/10 or 10/10 acceptance rule. Leave result cells blank rather than claiming unrun evidence.

- [ ] **Step 4: Run physical tests**

Install the PWA over HTTPS, switch each scanner phone to airplane mode, reload, and execute the full matrix against the same signed corpus displayed on another phone. Record every result in `docs/testing/scanner-phone-matrix.md`.

Expected: both phones satisfy every acceptance rule. Any failure remains open evidence and does not automatically justify encoder replacement; repeat it against a candidate reference encoder first.

### Task 6: Final verification

**Files:**
- Verify all files changed by Tasks 1–5.

- [ ] **Step 1: Run focused and complete tests**

Run: `node --test tests/scanner-decoder.test.mjs tests/scanner-pwa.test.mjs tests/qr-roundtrip.test.mjs tests/qr-encode.test.mjs tests/ticket-security.test.mjs`

Run: `npm test`

Expected: zero failures.

- [ ] **Step 2: Validate syntax and offline assets**

Run `node --check` for `src/scanner/qr-decoder.js`, `src/scanner/scanner-app.js`, `src/scanner/sw.js`, and every new `.mjs` test. Start the dev server, request every service-worker shell URL, and require HTTP 200.

- [ ] **Step 3: Audit scope and dependency state**

Run: `npm audit --omit=dev`

Run: `git diff --check`

Run: `git status --short`

Confirm `src/qr-encode.js` retains its preflight SHA-256 `54F4E12662056B9C2A79DE8186CCA31FEF8BFEE0940C2AC601D461C49EA8D079`, no private key fixture exists, and unrelated dirty-worktree files remain untouched.

- [ ] **Step 4: Report evidence honestly**

Separate automated results from physical-device results. Do not mark the active goal complete until the physical result sheet contains passing iPhone and Android evidence and every other numbered objective is proven.

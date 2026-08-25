# Scanner jsQR Fallback Design

**Status:** Approved direction from the active goal; implementation not yet verified on physical phones.

## Objective

Keep the current `NonsenseQR` encoder, add a locally bundled `jsQR` decoder fallback for browsers without native QR detection, make exact signed-ticket round trips reproducible in the automated suite, and use measured physical-phone results as the only basis for a later encoder replacement.

## Boundaries

This package remains a verification-only scanner prototype. The door PWA receives signed NT1 payloads, signed NTM1 manifests, and public keys. It does not receive or generate private signing keys. Adding an image decoder does not change the admission trust boundary: decoded camera text remains attacker-controlled until `NonsenseScannerCore` verifies the NT1 signature and applies event, session, revocation, serial, time-window, and duplicate rules.

This work does not select a backend, create production key custody, implement device authentication, upload queued scans, or claim that a purchase produces a live credential. It does not replace or delete `src/qr-encode.js`.

## Runtime architecture

The scanner keeps the existing camera stream and evaluation pipeline. A focused `src/scanner/qr-decoder.js` adapter owns image decoding behind one interface:

```text
camera frame
    |
    +-- BarcodeDetector supports qr_code --> native detect(video)
    |
    +-- otherwise -------------------------> canvas frame --> jsQR(ImageData)
                                                     |
                                                     v
                                            exact decoded string
                                                     |
                                                     v
                                            scanner.check(NT1 text)
```

Native `BarcodeDetector` remains the fast path. The adapter uses `jsQR` only when native QR detection is absent or does not advertise `qr_code`. The fallback owns one reusable canvas and context so scanning does not allocate a new canvas for every frame. It returns either an exact decoded string or no result; it never parses claims or makes an admission decision.

The existing 2.5-second camera-frame debounce remains after decoding. Manual entry remains available if camera permission, camera hardware, or both decoders fail.

## Offline packaging

`jsQR` is pinned in `package.json` and `package-lock.json`. Its browser distribution and license are copied into `src/scanner/vendor/` so the static PWA and GitHub Pages deployment never depend on npm or a CDN at the door. The scanner HTML loads the vendored decoder before `qr-decoder.js` and `scanner-app.js`.

The service-worker shell includes the vendored decoder and adapter, and its cache version is incremented. A clean service-worker install must fail if either asset is unavailable; an already installed scanner continues using its complete previous cache until the new shell is available.

## Automated verification

The test suite generates a real signed NT1 payload with WebCrypto, encodes it with the retained `NonsenseQR`, rasterizes the module matrix with the required four-module quiet zone, decodes the pixels with `jsQR`, and requires byte-for-byte equality with the original NT1 document. It then verifies the decoded signature and exercises session admission. Comparing only `ticketId` or selected claims is insufficient because the decoder must preserve the complete signed document.

The automated corpus covers:

- a normal high-contrast render;
- small module scales representing increased camera distance;
- reduced display brightness and reduced contrast;
- a bounded glare patch that leaves the finder patterns intact;
- a combo ticket admitted once for each granted session;
- a tampered decoded document rejected by the existing signature verifier;
- decoder selection with native QR support, without native support, and without either decoder;
- scanner HTML and service-worker inclusion of every offline decoder asset.

Automated optical transformations are regression tests, not evidence about real camera hardware.

## Physical-phone protocol

The required physical gate uses at least one current iPhone running Safari and one current Android phone running Chrome. Both devices load the scanner over HTTPS, switch to airplane mode after the PWA is installed, reload successfully offline, and scan the same signed test-ticket corpus from another phone display.

For each scanner phone, record ten attempts for every condition:

| Condition | Display brightness | Distance | Lighting |
| --- | ---: | ---: | --- |
| Baseline | 100% | 20 cm | diffuse indoor |
| Normal door | 50% | 35 cm | diffuse indoor |
| Dim ticket | 25% | 35 cm | diffuse indoor |
| Long reach | 100% | 50 cm | diffuse indoor |
| Glare | 100% | 35 cm | direct overhead reflection, ticket tilted 20 degrees |

A condition passes when at least 9 of 10 attempts decode the exact NT1 document within two seconds, no attempt returns different text, and the scanner produces the expected admission result. Baseline and normal-door conditions require 10 of 10. Record device model, OS version, browser version, QR rendered size, success count, median decode time, and any camera-focus failure.

The combo ticket is additionally scanned for Night 1 and Night 2 to prove one admission per entitlement, then rescanned on each night to prove duplicate rejection. This is admission testing, not merely camera testing.

## Encoder replacement gate

Do not replace `NonsenseQR` because a dependency is more popular. Replace it only when reproducible evidence identifies an encoder-caused failure:

1. The current encoder fails an automated independent decode or a physical condition in two complete runs.
2. The same NT1 input rendered at the same dimensions by a candidate encoder passes the failed condition.
3. The candidate passes the complete automated corpus, physical-phone protocol, payload-capacity boundary, offline packaging check, and license review.
4. Replacement occurs in a separate reviewed change that keeps rollback possible until the pilot is complete.

Failures caused by camera focus, browser decoding availability, service-worker installation, screen damage, or incorrect manifest/session setup do not justify replacing the encoder.

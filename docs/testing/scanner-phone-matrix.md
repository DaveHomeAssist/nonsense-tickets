# Scanner Physical-Phone Matrix

**Status:** Not run on physical phones. Automated raster tests are not a substitute for the
evidence recorded here.

**Desktop dry run (passed).** Before asking anyone to hold two phones, the whole loop was
exercised in a desktop browser: `npm run scanner:fixture` generated a kit, the display page
was rendered in Chromium, its QR was decoded from the rendered pixels by zbar and matched
the signed NT1 document exactly, and feeding that decoded text to the scanner produced
ADMIT / ALREADY IN on `night-1` and again on `night-2`, with an admitted counter of 2. That
proves the corpus, the encoder, and the admission rules agree. It proves nothing about
camera focus, screen glare, or reach — which is what the tables below are for.

## Generate the disposable test corpus

Run this immediately before the physical test:

```powershell
npm run scanner:fixture
```

The command creates an ignored, seven-day qualification kit in
`src/scanner/fixtures/generated/`:

- `index.html` displays the test QR and the public enrollment material;
- `fixture.json` contains the exact public corpus and identifiers;
- `ticket.svg` is the retained `NonsenseQR` encoder's output;
- `evidence.md` contains the values to copy into the test-corpus table below.

The publisher and ticket private keys exist only as non-exported in-memory
WebCrypto `CryptoKey` objects while the command runs. The kit contains only
public JWK material and signed documents. Regenerate it if it has expired, and
do not reuse this qualification credential at a live door.

Serve the scanner and generated display page from an HTTPS origin before using
a phone camera. HTTP on a laptop's LAN address is not a secure context on the
phone. Open `/scanner/fixtures/generated/` on the display phone and
`/scanner/` on the scanner phone. Install the public key and signed manifest
while online, wait for the service worker to finish installing, then enable
airplane mode and reload `/scanner/` before recording attempts.

## Acceptance rule

- Test at least one current iPhone with Safari and one current Android phone with Chrome.
- Install the scanner over HTTPS, open it once online, enable airplane mode, close and reopen it, and confirm the scanner shell and installed manifest still load.
- Run ten attempts per condition against the same signed NT1 corpus displayed on another phone.
- Baseline and normal-door conditions require 10/10 exact decodes within two seconds.
- Dim, long-reach, and glare conditions require at least 9/10 exact decodes within two seconds.
- No attempt may produce text different from the encoded NT1 document.
- Camera success is not enough: the expected `ADMIT`, `ALREADY IN`, and per-session combo results must appear.

## Test corpus

Record the immutable identifiers for the corpus used on both phones:

| Field | Value |
| --- | --- |
| Fixture-generation command | `npm run scanner:fixture` |
| Fixture SHA-256 | |
| Event ID | |
| Manifest version | |
| Ticket-key `kid` | |
| Combo ticket ID | |
| QR rendered width × height | |
| QR error-correction level | M |

Do not record or distribute a private key. The physical kit may contain only public keys, signed manifests, signed NT1 documents, and rendered QR images.

## iPhone / Safari

| Field | Value |
| --- | --- |
| Device model | |
| iOS version | |
| Safari version | |
| Decoder reported by scanner | jsQR |
| Offline reload passed | |

| Condition | Brightness | Distance | Lighting | Attempts 1–10 (pass/fail and ms) | Successes | Median ms | Admission result | Pass |
| --- | ---: | ---: | --- | --- | ---: | ---: | --- | --- |
| Baseline | 100% | 20 cm | diffuse indoor | | | | | |
| Normal door | 50% | 35 cm | diffuse indoor | | | | | |
| Dim ticket | 25% | 35 cm | diffuse indoor | | | | | |
| Long reach | 100% | 50 cm | diffuse indoor | | | | | |
| Glare | 100% | 35 cm | direct overhead reflection; ticket tilted 20° | | | | | |

## Android / Chrome

| Field | Value |
| --- | --- |
| Device model | |
| Android version | |
| Chrome version | |
| Decoder reported by scanner | |
| Offline reload passed | |

| Condition | Brightness | Distance | Lighting | Attempts 1–10 (pass/fail and ms) | Successes | Median ms | Admission result | Pass |
| --- | ---: | ---: | --- | --- | ---: | ---: | --- | --- |
| Baseline | 100% | 20 cm | diffuse indoor | | | | | |
| Normal door | 50% | 35 cm | diffuse indoor | | | | | |
| Dim ticket | 25% | 35 cm | diffuse indoor | | | | | |
| Long reach | 100% | 50 cm | diffuse indoor | | | | | |
| Glare | 100% | 35 cm | direct overhead reflection; ticket tilted 20° | | | | | |

## Combo admission

Use the same combo payload and change only the scanner's selected manifest session.

| Scanner | Session | First scan expected | First scan observed | Second scan expected | Second scan observed | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone / Safari | Night 1 | ADMIT | | ALREADY IN | | |
| iPhone / Safari | Night 2 | ADMIT | | ALREADY IN | | |
| Android / Chrome | Night 1 | ADMIT | | ALREADY IN | | |
| Android / Chrome | Night 2 | ADMIT | | ALREADY IN | | |

## Failure triage

For every failed condition, record a video or screen recording and classify the first failing boundary:

1. camera focus/exposure;
2. decoder returned no text;
3. decoder returned different text;
4. NT1 verification rejected the exact text;
5. manifest, session, time window, revocation, serial, or duplicate rule rejected it;
6. offline shell or stored state failed to load.

Only categories 2 or 3 can implicate QR rendering. Repeat those failures twice with the current encoder and then with a candidate reference encoder at identical dimensions before proposing replacement.

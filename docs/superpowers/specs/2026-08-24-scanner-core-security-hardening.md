# Scanner Core Security Hardening

**Status:** Prototype security core only. This document does not claim that an operational door scanner exists.

## Scope

This package defines signed ticket and manifest formats, issuance and transfer invariants, offline admission decisions, reconciliation behavior, and persistent-record validation. It establishes boundaries that a future backend and scanner client must preserve. It is not a deployable ticketing or scanning system by itself.

## NT1 ticket trust boundary

An `NT1` document is `NT1.<canonical-body>.<signature>`. The fixed prefix binds the format to ECDSA P-256 with SHA-256; there is no caller-selected algorithm. WebCrypto performs all signing and verification. The core only frames the bytes, validates claims, and canonicalizes the raw P-256 signature to low-S form.

The signature covers the exact `NT1.<base64url-body>` bytes. The body must use the one canonical JSON representation, and verification rejects noncanonical base64url and high-S signature twins. The claims contain opaque ticket and event identifiers and session grants, but no holder name, email address, or order details.

Possession of a valid `NT1` document proves only that a holder has a payload signed by a currently trusted ticket key. Admission also depends on the cached manifest, event and session match, door window, revocation state, minimum serial, and local redemption history. Ticket-signing private keys must remain in a future trusted issuance service; the current package does not provide production key custody.

## NTM1 manifest trust boundary

An `NTM1` document is `NTM1.<canonical-manifest>.<signature>`. A device may trust it only after verifying the signature against publisher keys pinned independently of the manifest. A manifest cannot introduce its own trust anchor.

Ticket keys carried by a manifest are usable only after the publisher signature verifies. Every carried `kid` must equal `NonsenseTicketPayload.keyIdFromJwk(jwk)`, every JWK must import through WebCrypto as a P-256 verification key, and private key material is forbidden. Manifest signatures are low-S canonical and high-S twins are rejected.

Manifest versions are monotonic per installed device. A device must reject a version lower than its installed version. That prevents replay of an older signed document from rolling back a revocation after the newer manifest has reached that device; it does not make disconnected devices immediately consistent.

## Offline consistency limit

Offline admission is locally authoritative only for one scanner's cached state. A scanner prevents a second admission for the same `(ticketId, sessionId)` in its own restored log. Two disconnected devices can still admit the same ticket for the same session before either sees the other's record. No cryptographic format can remove that availability-versus-consistency limit without online coordination or a shared local channel.

Reconciliation detects this condition after upload. The earliest device-reported `scannedAt` wins, with `deviceId` as a deterministic tie-breaker, and later admissions are conflicts. That ordering produces a repeatable audit result; it does not prove which physical entry happened first.

## Scan retry contract

Every physical scan attempt receives one UUID `scanId` from `crypto.randomUUID()`. The identifier is stable in the recorded decision, `pendingBatch()`, persistence snapshots, restore, transport retries, and reconciliation.

Delivery is at-least-once: replaying a byte-for-byte equivalent record with the same `scanId` is idempotent and creates neither a second admission nor a conflict. Reusing a `scanId` with different record content is invalid and must be rejected, not merged. Persistent catalogs require both redemption record IDs and `scanId` values to be unique and require each redemption's device and session to belong to the redemption event.

The caller that eventually persists or transports a pending batch must preserve the complete record. Creating a new `scanId` for a retry changes its meaning from delivery retry to a new physical scan attempt.

## Transfers, revocations, and stale manifests

Transfer grants are derived only from validated active entitlement records for the transferred `ticketId`; callers cannot select or add session IDs. Issuance also requires the paid order total to equal `(facePriceCents + feeCents) * quantity` before any ticket is signed.

A transfer increments the ticket serial, and a revocation lists the ticket in a later manifest. A disconnected device using an older but otherwise valid manifest can still admit the prior holder's payload or a newly revoked ticket. Protection starts when the device installs the updated manifest. A future operational system must define manifest publication, required refresh frequency, maximum offline age, and a fail-open or fail-closed policy when freshness cannot be established.

## Device-clock assumptions

The core treats `scannedAt` and caller-supplied `now` as the door device's epoch-seconds clock. Payload expiry, manifest expiry, door windows, and conflict ordering therefore assume a reasonably synchronized and nonmalicious clock. The scanner's current default door-window and payload-expiry allowance is 120 seconds of clock skew.

Device clocks are not authenticated. A future enrolled client should synchronize time before doors, surface excessive drift, record server receipt time separately, and prevent ordinary operators from rewriting audit timestamps. Server reconciliation must not treat the current earliest-time rule as fraud-proof evidence.

## Explicitly absent

None of the following exists in this security-core package:

- camera capture or a scanner PWA;
- durable browser or server persistence;
- device authentication, enrollment, authorization, or remote disablement;
- synchronization, upload, issuance, transfer, or revocation APIs;
- a service worker, IndexedDB offline queue, or background retry mechanism;
- production key generation, KMS/HSM custody, rotation, recovery, or incident response;
- backend authentication, authorization, atomic transactions, payment verification, or operational monitoring.

The session timestamps and Night 1/Night 2 fixtures in the tests are synthetic security examples, not production event facts. Backend, packaging, QR dependency, authentication, and key-management choices remain separate design decisions.

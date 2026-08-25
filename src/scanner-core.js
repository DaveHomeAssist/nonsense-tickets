(function exposeScannerCore(root) {
  'use strict';

  const SCAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /* ------------------------------------------------------------------ *
   * The door decision engine.
   *
   * Everything here runs with no network. It is deliberately separated
   * from the camera so the admission rules can be tested exhaustively
   * without a device: give it a payload string and it returns a decision.
   *
   * The engine holds a local redemption log keyed by (ticketId, sessionId).
   * That is the whole reason a combo ticket works - the same ticket is a
   * separate admission right on each night it was sold for.
   *
   * A single device can only detect duplicates it has seen itself. Two
   * offline devices at two doors will both admit the same ticket, and that
   * is expected: reconcileRedemptions resolves it once they sync, and the
   * loser is reported as a conflict rather than silently dropped.
   * ------------------------------------------------------------------ */

  function payloadTools() {
    const tools = root.NonsenseTicketPayload;
    if (!tools) throw new Error('ticket-payload.js must load before scanner-core.js.');
    return tools;
  }

  function manifestTools() {
    const tools = root.NonsenseTicketManifest;
    if (!tools) throw new Error('ticket-manifest.js must load before scanner-core.js.');
    return tools;
  }

  function key(ticketId, sessionId) {
    return ticketId + ' ' + sessionId;
  }

  function epochSeconds(value, name) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(name + ' must be a nonnegative integer of epoch seconds.');
    return value;
  }

  function newScanId() {
    const web = root.crypto;
    if (!web || typeof web.randomUUID !== 'function') {
      throw new Error('crypto.randomUUID() is required to identify scan attempts.');
    }
    return web.randomUUID();
  }

  function requireScanId(value) {
    if (typeof value !== 'string' || !SCAN_ID_PATTERN.test(value)) {
      throw new RangeError('scanId must be a UUID generated for one physical scan attempt.');
    }
    return value;
  }

  function entryFingerprint(entry) {
    const normalized = {};
    Object.keys(entry).sort().forEach((name) => {
      if (entry[name] !== undefined) normalized[name] = entry[name];
    });
    return JSON.stringify(normalized);
  }

  /**
   * Build a scanner bound to one verified manifest.
   *
   * The manifest must already have been checked with verifyManifest against
   * the device's pinned publisher keys. This function does not re-establish
   * trust; it consumes an established one.
   */
  function createScanner(options) {
    const settings = options || {};
    const manifest = settings.manifest;
    if (!manifest || typeof manifest !== 'object') throw new TypeError('createScanner requires a verified manifest.');
    const deviceId = settings.deviceId;
    if (typeof deviceId !== 'string' || !deviceId) throw new RangeError('createScanner requires a deviceId.');

    const tools = payloadTools();
    const keys = manifestTools().ticketKeysFromManifest(manifest);
    const sessions = new Map(manifest.sessions.map((session) => [session.id, session]));
    const revoked = new Set(manifest.revoked);
    const minSerials = manifest.minSerials || {};
    const clockSkewSeconds = settings.clockSkewSeconds == null ? 120 : epochSeconds(settings.clockSkewSeconds, 'clockSkewSeconds');

    /* ticketId+sessionId -> the admitted redemption. Rejections are appended
       to the audit log but never occupy this map. */
    const admitted = new Map();
    const log = [];
    const scans = new Map();

    function remember(entry) {
      const scanId = requireScanId(entry.scanId);
      const fingerprint = entryFingerprint(entry);
      const previous = scans.get(scanId);
      if (previous != null) {
        if (previous !== fingerprint) throw new RangeError('conflicting records share scanId ' + scanId + '.');
        return false;
      }
      scans.set(scanId, fingerprint);
      log.push(entry);
      return true;
    }

    function record(entry) {
      if (!remember(entry)) throw new RangeError('scanId ' + entry.scanId + ' was already recorded.');
      return entry;
    }

    async function evaluate(payloadText, evaluateOptions) {
      const call = evaluateOptions || {};
      const sessionId = call.sessionId;
      if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
        throw new RangeError('evaluate requires a sessionId present in the manifest.');
      }
      const now = epochSeconds(call.now == null ? Math.floor(Date.now() / 1000) : call.now, 'now');
      const session = sessions.get(sessionId);

      const base = {
        scanId: newScanId(),
        deviceId,
        sessionId,
        eventId: manifest.eventId,
        manifestVersion: manifest.version,
        scannedAt: now
      };

      /* 1. Cryptography first. Nothing below this line may read a claim from
         an unverified payload. */
      const verified = await tools.verifyTicketPayload(payloadText, keys, {now, clockSkewSeconds});

      if (verified.status === 'malformed') {
        return record({...base, result: 'bad_signature', ticketId: undefined, reason: verified.reason});
      }
      if (verified.status === 'unknown_key' || verified.status === 'bad_signature') {
        return record({
          ...base,
          result: 'bad_signature',
          ticketId: verified.claims ? verified.claims.ticketId : undefined,
          reason: verified.reason
        });
      }

      const claims = verified.claims;

      /* 2. Wrong event is checked before expiry so a ticket for another show
         reads as "wrong show", not "expired ticket", at the door. */
      if (claims.eventId !== manifest.eventId) {
        return record({...base, result: 'wrong_event', ticketId: claims.ticketId, reason: 'Payload is for event ' + claims.eventId + '.'});
      }

      if (verified.status === 'expired') {
        return record({...base, result: 'expired', ticketId: claims.ticketId, reason: verified.reason});
      }

      /* 3. Revocation and transfer supersession. Both come from the manifest,
         which is why manifest freshness is an operational requirement and not
         a nice-to-have. */
      if (revoked.has(claims.ticketId)) {
        return record({...base, result: 'revoked', ticketId: claims.ticketId, reason: 'Ticket is revoked.'});
      }
      const minSerial = minSerials[claims.ticketId];
      if (minSerial != null && claims.serial < minSerial) {
        return record({
          ...base,
          result: 'superseded',
          ticketId: claims.ticketId,
          reason: 'Ticket was transferred; this copy is serial ' + claims.serial + ' and the door requires ' + minSerial + '.'
        });
      }

      /* 4. Entitlement: does this ticket grant THIS session? */
      if (!claims.sessionIds.includes(sessionId)) {
        return record({
          ...base,
          result: 'not_entitled',
          ticketId: claims.ticketId,
          reason: 'Ticket grants ' + claims.sessionIds.join(', ') + '.'
        });
      }

      /* 5. Door window for this session. */
      if (now + clockSkewSeconds < session.opensAt || now - clockSkewSeconds > session.closesAt) {
        return record({
          ...base,
          result: 'outside_window',
          ticketId: claims.ticketId,
          reason: 'Doors for ' + session.label + ' are not open.'
        });
      }

      /* 6. Local duplicate detection, keyed by (ticketId, sessionId). */
      const admissionKey = key(claims.ticketId, sessionId);
      const previous = admitted.get(admissionKey);
      if (previous) {
        return record({
          ...base,
          result: 'duplicate',
          ticketId: claims.ticketId,
          reason: 'Already admitted on this device at ' + new Date(previous.scannedAt * 1000).toISOString() + '.',
          firstScannedAt: previous.scannedAt
        });
      }

      const decision = record({...base, result: 'admitted', ticketId: claims.ticketId, reason: undefined});
      admitted.set(admissionKey, decision);
      return decision;
    }

    return {
      deviceId,
      eventId: manifest.eventId,
      manifestVersion: manifest.version,
      evaluate,
      /* The queue handed to the server when signal comes back. Includes
         rejections: a run of bad_signature scans at one door is the signal
         that someone is working a forgery at that entrance. */
      pendingBatch: () => log.slice(),
      admittedCount: () => admitted.size,
      /* Restore a device that was closed mid-show. */
      restore(entries) {
        (entries || []).forEach((entry) => {
          if (!entry || typeof entry !== 'object') throw new TypeError('Restored scan entries must be objects.');
          if (!remember(entry)) return;
          if (entry && entry.result === 'admitted' && entry.ticketId && entry.sessionId) {
            const admissionKey = key(entry.ticketId, entry.sessionId);
            if (!admitted.has(admissionKey)) admitted.set(admissionKey, entry);
          }
        });
      }
    };
  }

  /**
   * Server-side reconciliation of queued offline batches.
   *
   * Rule: for each (ticketId, sessionId) the earliest scannedAt wins. Later
   * admissions become conflicts. Ties break on deviceId so the result is
   * deterministic no matter what order the devices sync in - two runs over
   * the same batches must never produce different admissions.
   *
   * A conflict is not automatically fraud. Two doors, one crowd, and no
   * signal produce them honestly. The output is an operations report, not
   * an accusation.
   */
  function reconcileRedemptions(batches) {
    if (!Array.isArray(batches)) throw new TypeError('batches must be an array of scan entries.');
    const received = batches
      .flat()
      .filter((entry) => entry && typeof entry === 'object');
    const scans = new Map();
    const unique = [];
    received.forEach((entry) => {
      const scanId = requireScanId(entry.scanId);
      const fingerprint = entryFingerprint(entry);
      const previous = scans.get(scanId);
      if (previous != null) {
        if (previous !== fingerprint) throw new RangeError('conflicting records share scanId ' + scanId + '.');
        return;
      }
      scans.set(scanId, fingerprint);
      unique.push(entry);
    });
    const entries = unique.filter((entry) => entry.result === 'admitted' && entry.ticketId && entry.sessionId);

    const ordered = entries.slice().sort((a, b) => {
      if (a.scannedAt !== b.scannedAt) return a.scannedAt - b.scannedAt;
      if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
      return 0;
    });

    const winners = new Map();
    const conflicts = [];
    ordered.forEach((entry) => {
      const admissionKey = key(entry.ticketId, entry.sessionId);
      const winner = winners.get(admissionKey);
      if (!winner) {
        winners.set(admissionKey, entry);
        return;
      }
      conflicts.push({
        ticketId: entry.ticketId,
        sessionId: entry.sessionId,
        admittedBy: winner.deviceId,
        admittedAt: winner.scannedAt,
        alsoAdmittedBy: entry.deviceId,
        alsoAdmittedAt: entry.scannedAt,
        /* Same device twice means the device lost its local log. Different
           devices means either a real double entry or two doors out of sync. */
        sameDevice: winner.deviceId === entry.deviceId
      });
    });

    return {
      admitted: Array.from(winners.values()),
      conflicts,
      rejected: unique.filter((entry) => entry.result !== 'admitted')
    };
  }

  root.NonsenseScannerCore = Object.freeze({
    createScanner,
    reconcileRedemptions
  });
})(globalThis);

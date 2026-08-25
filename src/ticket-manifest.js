(function exposeTicketManifest(root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * NTM1 - the signed offline manifest a door device caches before the
   * show, and the only thing it trusts once the signal drops.
   *
   * Wire format:   NTM1.<base64url(json)>.<base64url(signature)>
   *
   * The "NTM1" prefix is deliberately different from the ticket payload's
   * "NT1". The signature covers the prefixed bytes, so a ticket payload
   * can never be replayed as a manifest and a manifest can never be
   * replayed as a ticket, even though both use the same key pair.
   *
   * A manifest is versioned and monotonic. A door device must refuse to
   * install a manifest whose version is lower than the one it already
   * holds, otherwise revoking a ticket could be undone by replaying an
   * older signed manifest at the door.
   * ------------------------------------------------------------------ */

  const PREFIX = 'NTM1';
  const SIGN_PARAMS = Object.freeze({name: 'ECDSA', hash: 'SHA-256'});
  const SIGNATURE_BYTES = 64;

  const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
  const OPAQUE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function payloadTools() {
    const tools = root.NonsenseTicketPayload;
    if (!tools) throw new Error('ticket-payload.js must load before ticket-manifest.js.');
    return tools;
  }

  function subtle() {
    const web = root.crypto;
    if (!web || !web.subtle) throw new Error('WebCrypto SubtleCrypto is required for manifests.');
    return web.subtle;
  }

  /* Deterministic JSON: recursively sorted keys, no undefined, no holes.
     Used both to build and to re-check a received manifest, so one manifest
     has exactly one legal byte encoding. */
  function canonicalJson(value) {
    if (value === null) return 'null';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError('Manifest numbers must be finite.');
      return JSON.stringify(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
      return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
    }
    throw new TypeError('Manifest values must be JSON primitives, arrays, or objects.');
  }

  function slug(value, name) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new RangeError(name + ' must be a slug identifier.');
    return value;
  }

  function opaque(value, name) {
    if (typeof value !== 'string' || !OPAQUE_PATTERN.test(value)) {
      throw new RangeError(name + ' must be a 26 character Crockford base32 identifier.');
    }
    return value;
  }

  function epochSeconds(value, name) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(name + ' must be a nonnegative integer of epoch seconds.');
    return value;
  }

  function normalizeManifest(input) {
    if (!input || typeof input !== 'object') throw new TypeError('manifest must be an object.');

    const version = input.version;
    if (!Number.isInteger(version) || version < 1) throw new RangeError('manifest.version must be an integer of at least 1.');

    const issuedAt = epochSeconds(input.issuedAt, 'manifest.issuedAt');
    const expiresAt = epochSeconds(input.expiresAt, 'manifest.expiresAt');
    if (expiresAt <= issuedAt) throw new RangeError('manifest.expiresAt must be later than manifest.issuedAt.');

    const sessions = input.sessions;
    if (!Array.isArray(sessions) || !sessions.length) throw new RangeError('manifest.sessions must be a non-empty array.');
    const sessionIds = new Set();
    const normalizedSessions = sessions.map((session, index) => {
      if (!session || typeof session !== 'object') throw new TypeError('manifest.sessions[' + index + '] must be an object.');
      const id = slug(session.id, 'manifest.sessions[' + index + '].id');
      if (sessionIds.has(id)) throw new RangeError('manifest session ids must be unique.');
      sessionIds.add(id);
      return {
        id,
        label: String(session.label == null ? id : session.label),
        startsAt: epochSeconds(session.startsAt, 'manifest.sessions[' + index + '].startsAt'),
        endsAt: session.endsAt == null ? undefined : epochSeconds(session.endsAt, 'manifest.sessions[' + index + '].endsAt'),
        /* The window during which this device will admit for this session.
           Outside it the scanner reports not_entitled rather than admitting
           a valid Night 1 ticket on Night 2. */
        opensAt: epochSeconds(session.opensAt, 'manifest.sessions[' + index + '].opensAt'),
        closesAt: epochSeconds(session.closesAt, 'manifest.sessions[' + index + '].closesAt')
      };
    });
    normalizedSessions.forEach((session) => {
      if (session.closesAt <= session.opensAt) throw new RangeError('manifest session door window must be positive.');
    });

    const keys = input.keys;
    if (!Array.isArray(keys) || !keys.length) throw new RangeError('manifest.keys must be a non-empty array.');
    const keyIds = new Set();
    const normalizedKeys = keys.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new TypeError('manifest.keys[' + index + '] must be an object.');
      const kid = slug(entry.kid, 'manifest.keys[' + index + '].kid');
      if (keyIds.has(kid)) throw new RangeError('manifest key ids must be unique.');
      keyIds.add(kid);
      const jwk = entry.jwk;
      if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
        throw new RangeError('manifest.keys[' + index + '].jwk must be a P-256 public JWK.');
      }
      if (jwk.d) throw new RangeError('manifest.keys[' + index + '].jwk must not contain private material.');
      return {kid, jwk: {crv: 'P-256', kty: 'EC', x: String(jwk.x), y: String(jwk.y)}};
    });

    const revoked = input.revoked == null ? [] : input.revoked;
    if (!Array.isArray(revoked)) throw new TypeError('manifest.revoked must be an array.');
    const revokedIds = revoked.map((value, index) => opaque(value, 'manifest.revoked[' + index + ']'));
    if (new Set(revokedIds).size !== revokedIds.length) throw new RangeError('manifest.revoked must not contain duplicates.');

    /* Minimum accepted serial per ticket. A transfer bumps the ticket serial,
       so the previous holder's screenshot - a perfectly valid signature over
       the old serial - stops admitting once this manifest reaches the door. */
    const serialsInput = input.minSerials == null ? {} : input.minSerials;
    if (!serialsInput || typeof serialsInput !== 'object' || Array.isArray(serialsInput)) {
      throw new TypeError('manifest.minSerials must be an object.');
    }
    const minSerials = {};
    Object.keys(serialsInput).forEach((ticketId) => {
      opaque(ticketId, 'manifest.minSerials key');
      const serial = serialsInput[ticketId];
      if (!Number.isInteger(serial) || serial < 1) throw new RangeError('manifest.minSerials values must be integers of at least 1.');
      minSerials[ticketId] = serial;
    });

    return {
      v: 1,
      eventId: slug(input.eventId, 'manifest.eventId'),
      version,
      issuedAt,
      expiresAt,
      timeZone: String(input.timeZone || 'UTC'),
      title: String(input.title == null ? '' : input.title),
      sessions: normalizedSessions.sort((a, b) => (a.id < b.id ? -1 : 1)),
      keys: normalizedKeys.sort((a, b) => (a.kid < b.kid ? -1 : 1)),
      revoked: revokedIds.slice().sort(),
      minSerials
    };
  }

  async function validateTicketKeys(manifest) {
    const tools = payloadTools();
    for (let index = 0; index < manifest.keys.length; index += 1) {
      const entry = manifest.keys[index];
      const derived = await tools.keyIdFromJwk(entry.jwk);
      if (entry.kid !== derived) {
        throw new RangeError('manifest.keys[' + index + '].kid must be derived from its JWK.');
      }
      try {
        await tools.importVerifyKey(entry.jwk);
      } catch {
        throw new RangeError('manifest.keys[' + index + '].jwk must be imported as a P-256 verification key.');
      }
    }
  }

  async function buildManifest(input, privateKey) {
    const tools = payloadTools();
    const manifest = normalizeManifest(input);
    await validateTicketKeys(manifest);
    const json = canonicalJson(manifest);
    const signingInput = PREFIX + '.' + tools.base64UrlEncode(encoder.encode(json));
    const key = privateKey && privateKey.type === 'private' ? privateKey : await tools.importSigningKey(privateKey);
    const signature = tools.normalizeP256Signature(
      await subtle().sign(SIGN_PARAMS, key, encoder.encode(signingInput))
    );
    if (signature.length !== SIGNATURE_BYTES) throw new Error('Unexpected manifest signature length.');
    return {manifest, document: signingInput + '.' + tools.base64UrlEncode(signature)};
  }

  function decodeManifest(text) {
    const tools = payloadTools();
    if (typeof text !== 'string') throw new TypeError('A manifest document must be a string.');
    const segments = text.trim().split('.');
    if (segments.length !== 3) throw new RangeError('A manifest document has three dot separated segments.');
    if (segments[0] !== PREFIX) throw new RangeError('Unsupported manifest version.');
    const json = decoder.decode(tools.base64UrlDecode(segments[1]));
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new RangeError('Manifest body is not JSON.');
    }
    const manifest = normalizeManifest(parsed);
    if (canonicalJson(manifest) !== json) throw new RangeError('Manifest body is not canonically encoded.');
    const signature = tools.base64UrlDecode(segments[2]);
    if (signature.length !== SIGNATURE_BYTES) throw new RangeError('Manifest signature length is wrong.');
    return {manifest, signature, signingInput: segments[0] + '.' + segments[1]};
  }

  /**
   * Verify a manifest document against the device's pinned trust anchors.
   *
   * trustedKeys is the set of publisher keys burned into the scanner at
   * enrollment. A manifest is NOT allowed to introduce its own trust: the
   * keys it carries are ticket signing keys, and they are only usable once
   * the manifest itself verifies against an already trusted publisher key.
   */
  async function verifyManifest(text, trustedKeys, options) {
    const tools = payloadTools();
    const settings = options || {};
    let decoded;
    try {
      decoded = decodeManifest(text);
    } catch (error) {
      return {status: 'malformed', reason: error.message, manifest: undefined};
    }

    if (!tools.isLowP256Signature(decoded.signature)) {
      return {status: 'bad_signature', reason: 'P-256 signatures must use low-S canonical form.', manifest: undefined};
    }

    const lookup = trustedKeys instanceof Map ? trustedKeys : new Map(Object.entries(trustedKeys || {}));
    let verified = false;
    for (const material of lookup.values()) {
      let key;
      try {
        key = material.type === 'public' ? material : await tools.importVerifyKey(material);
      } catch {
        continue;
      }
      /* eslint-disable no-await-in-loop */
      if (await subtle().verify(SIGN_PARAMS, key, decoded.signature, encoder.encode(decoded.signingInput))) {
        verified = true;
        break;
      }
      /* eslint-enable no-await-in-loop */
    }
    if (!verified) return {status: 'bad_signature', reason: 'Manifest signature did not verify.', manifest: undefined};

    /* Ticket signing keys become trusted only after the manifest publisher
       signature has verified against an independently pinned key. */
    try {
      await validateTicketKeys(decoded.manifest);
    } catch (error) {
      return {status: 'malformed', reason: error.message, manifest: undefined};
    }

    if (settings.now != null) {
      const now = epochSeconds(settings.now, 'options.now');
      if (now > decoded.manifest.expiresAt) {
        return {status: 'expired', reason: 'Manifest expired.', manifest: decoded.manifest};
      }
    }

    /* Monotonic version guard. Refusing an older signed manifest is what stops
       a revocation from being rolled back by replaying yesterday's download. */
    if (settings.installedVersion != null) {
      const installed = settings.installedVersion;
      if (!Number.isInteger(installed) || installed < 0) throw new RangeError('options.installedVersion must be a nonnegative integer.');
      if (decoded.manifest.version < installed) {
        return {status: 'stale', reason: 'Manifest version ' + decoded.manifest.version + ' is older than installed ' + installed + '.', manifest: decoded.manifest};
      }
    }

    return {status: 'valid', reason: undefined, manifest: decoded.manifest};
  }

  /* Convenience for the scanner: keyId -> JWK, ready for verifyTicketPayload. */
  function ticketKeysFromManifest(manifest) {
    const keys = {};
    manifest.keys.forEach((entry) => { keys[entry.kid] = entry.jwk; });
    return keys;
  }

  root.NonsenseTicketManifest = Object.freeze({
    PREFIX,
    canonicalJson,
    normalizeManifest,
    buildManifest,
    decodeManifest,
    verifyManifest,
    ticketKeysFromManifest
  });
})(globalThis);

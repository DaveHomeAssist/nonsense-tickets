(function exposeTicketPayload(root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * NT1 - the signed ticket payload that goes inside the QR code.
   *
   * Wire format:   NT1.<base64url(body)>.<base64url(signature)>
   *
   * Design rules, each one load bearing:
   *
   * 1. The "NT1" prefix binds BOTH the payload version and the algorithm
   *    (ECDSA P-256 with SHA-256, raw r||s signatures). There is no `alg`
   *    field inside the payload, so there is nothing for a forger to
   *    downgrade to "none" or to a symmetric algorithm. Adding an
   *    algorithm later means adding NT2, never a negotiated field.
   * 2. The signature covers the exact ASCII bytes "NT1.<body>" as received.
   *    Verification never re-serializes the body first, so a JSON quirk
   *    cannot separate what was signed from what is checked.
   * 3. The body carries no PII. Ticket and holder references are opaque
   *    random identifiers. A scanned QR, a photo of a QR, or a leaked
   *    manifest reveals no name, email, or order.
   * 4. Crypto comes from the platform (WebCrypto SubtleCrypto: OpenSSL in
   *    Node, the OS provider in browsers). This module implements framing
   *    and validation only - never primitives.
   * ------------------------------------------------------------------ */

  const PREFIX = 'NT1';
  const ALGORITHM = Object.freeze({name: 'ECDSA', namedCurve: 'P-256'});
  const SIGN_PARAMS = Object.freeze({name: 'ECDSA', hash: 'SHA-256'});
  const SIGNATURE_BYTES = 64; /* raw r||s for P-256 */
  const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const P256_HALF_ORDER = P256_ORDER >> 1n;
  const BODY_KEYS = Object.freeze(['v', 'k', 'e', 't', 's', 'n', 'i', 'x']);

  const VERIFY_STATUSES = Object.freeze([
    'valid',
    'malformed',
    'unknown_key',
    'bad_signature',
    'expired'
  ]);

  const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
  const OPAQUE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
  const B64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

  const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64URL_LOOKUP = (() => {
    const table = new Map();
    for (let index = 0; index < B64URL_ALPHABET.length; index += 1) {
      table.set(B64URL_ALPHABET[index], index);
    }
    return table;
  })();

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function subtle() {
    const web = root.crypto;
    if (!web || !web.subtle) {
      throw new Error('WebCrypto SubtleCrypto is required to sign or verify ticket payloads.');
    }
    return web.subtle;
  }

  /* ---- base64url, implemented directly so no btoa/Buffer split exists ---- */

  function base64UrlEncode(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let output = '';
    for (let index = 0; index < input.length; index += 3) {
      const remaining = input.length - index;
      const a = input[index];
      const b = remaining > 1 ? input[index + 1] : 0;
      const c = remaining > 2 ? input[index + 2] : 0;
      output += B64URL_ALPHABET[a >> 2];
      output += B64URL_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
      if (remaining > 1) output += B64URL_ALPHABET[((b & 0x0f) << 2) | (c >> 6)];
      if (remaining > 2) output += B64URL_ALPHABET[c & 0x3f];
    }
    return output;
  }

  function base64UrlDecode(text) {
    if (typeof text !== 'string' || !text || !B64URL_PATTERN.test(text)) {
      throw new RangeError('Value is not base64url.');
    }
    if (text.length % 4 === 1) throw new RangeError('Value is not base64url.');
    const size = Math.floor((text.length * 3) / 4);
    const bytes = new Uint8Array(size);
    let cursor = 0;
    for (let index = 0; index < text.length; index += 4) {
      const chunk = text.slice(index, index + 4);
      let accumulator = 0;
      for (let position = 0; position < chunk.length; position += 1) {
        accumulator = (accumulator << 6) | B64URL_LOOKUP.get(chunk[position]);
      }
      const bits = chunk.length * 6;
      const usable = Math.floor(bits / 8);
      /* A short final group carries leftover low bits that decode to nothing.
         They must be zero, otherwise one byte string has several valid
         encodings and the same ticket can arrive as several distinct QR
         strings. Canonical input only. */
      const slack = bits - usable * 8;
      if (slack > 0 && (accumulator & ((1 << slack) - 1)) !== 0) {
        throw new RangeError('Value is not canonical base64url.');
      }
      for (let byte = 0; byte < usable; byte += 1) {
        const shift = bits - 8 * (byte + 1);
        bytes[cursor] = (accumulator >> shift) & 0xff;
        cursor += 1;
      }
    }
    return bytes.subarray(0, cursor);
  }

  /* ECDSA admits a second valid signature (r, n - s) for every (r, s).
     NT1 permits only the low-S representation so one signed ticket has one
     signature encoding. Signing and verification remain WebCrypto's job. */
  function signatureScalarS(signature) {
    const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    if (bytes.length !== SIGNATURE_BYTES) {
      throw new RangeError('Expected a ' + SIGNATURE_BYTES + ' byte raw P-256 signature.');
    }
    let scalar = 0n;
    for (let index = SIGNATURE_BYTES / 2; index < SIGNATURE_BYTES; index += 1) {
      scalar = (scalar << 8n) | BigInt(bytes[index]);
    }
    return scalar;
  }

  function normalizeP256Signature(signature) {
    const bytes = signature instanceof Uint8Array
      ? new Uint8Array(signature)
      : new Uint8Array(signature);
    const scalar = signatureScalarS(bytes);
    if (scalar <= 0n || scalar >= P256_ORDER) throw new RangeError('P-256 signature S scalar is out of range.');
    if (scalar <= P256_HALF_ORDER) return bytes;

    let low = P256_ORDER - scalar;
    for (let index = SIGNATURE_BYTES - 1; index >= SIGNATURE_BYTES / 2; index -= 1) {
      bytes[index] = Number(low & 0xffn);
      low >>= 8n;
    }
    return bytes;
  }

  function isLowP256Signature(signature) {
    try {
      const scalar = signatureScalarS(signature);
      return scalar > 0n && scalar <= P256_HALF_ORDER;
    } catch {
      return false;
    }
  }

  /* ---- keys ---- */

  async function generateSigningKeyPair() {
    const pair = await subtle().generateKey(ALGORITHM, true, ['sign', 'verify']);
    const publicKeyJwk = await subtle().exportKey('jwk', pair.publicKey);
    delete publicKeyJwk.key_ops;
    delete publicKeyJwk.ext;
    const keyId = await keyIdFromJwk(publicKeyJwk);
    return {privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyJwk, keyId};
  }

  /* RFC 7638 style thumbprint, truncated. Key ids are therefore derived from
     the key itself: a manifest cannot silently swap a key under a known id. */
  async function keyIdFromJwk(jwk) {
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
      throw new RangeError('Signing keys must be P-256 EC JWKs.');
    }
    const canonical = '{"crv":"P-256","kty":"EC","x":"' + jwk.x + '","y":"' + jwk.y + '"}';
    const digest = await subtle().digest('SHA-256', encoder.encode(canonical));
    /* Lowercase hex so a key id is a legal slug everywhere it is used as one:
       payload field, manifest index, and record identifier. */
    return Array.from(new Uint8Array(digest).subarray(0, 8))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function importVerifyKey(jwk) {
    if (!jwk || typeof jwk !== 'object') throw new TypeError('Public key JWK must be an object.');
    if (jwk.d) throw new RangeError('A verification key must not contain private material.');
    const material = {kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y};
    return subtle().importKey('jwk', material, ALGORITHM, false, ['verify']);
  }

  async function importSigningKey(jwk) {
    if (!jwk || typeof jwk !== 'object' || !jwk.d) throw new RangeError('A signing key JWK must contain private material.');
    return subtle().importKey('jwk', jwk, ALGORITHM, false, ['sign']);
  }

  /* ---- claims ---- */

  function epochSeconds(value, name) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(name + ' must be a nonnegative integer of epoch seconds.');
    return value;
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

  /* Canonical body. Fixed key order and no optional keys keeps issuance
     byte-for-byte deterministic, which is what makes a payload reproducible
     from stored records during a dispute. */
  function canonicalBody(claims) {
    if (!claims || typeof claims !== 'object') throw new TypeError('claims must be an object.');
    const sessionIds = claims.sessionIds;
    if (!Array.isArray(sessionIds) || !sessionIds.length) {
      throw new RangeError('claims.sessionIds must list at least one granted session.');
    }
    const grants = sessionIds.map((value, index) => slug(value, 'claims.sessionIds[' + index + ']'));
    if (new Set(grants).size !== grants.length) throw new RangeError('claims.sessionIds must not contain duplicates.');
    const issuedAt = epochSeconds(claims.issuedAt, 'claims.issuedAt');
    const expiresAt = epochSeconds(claims.expiresAt, 'claims.expiresAt');
    if (expiresAt <= issuedAt) throw new RangeError('claims.expiresAt must be later than claims.issuedAt.');
    const serial = claims.serial;
    if (!Number.isInteger(serial) || serial < 1) throw new RangeError('claims.serial must be an integer of at least 1.');

    return {
      v: 1,
      k: slug(claims.keyId, 'claims.keyId'),
      e: slug(claims.eventId, 'claims.eventId'),
      t: opaque(claims.ticketId, 'claims.ticketId'),
      s: grants.slice().sort(),
      n: serial,
      i: issuedAt,
      x: expiresAt
    };
  }

  function serializeBody(body) {
    /* Explicit ordering rather than JSON.stringify key order luck. */
    return '{"v":' + body.v +
      ',"k":"' + body.k + '"' +
      ',"e":"' + body.e + '"' +
      ',"t":"' + body.t + '"' +
      ',"s":[' + body.s.map((value) => '"' + value + '"').join(',') + ']' +
      ',"n":' + body.n +
      ',"i":' + body.i +
      ',"x":' + body.x + '}';
  }

  function parseBody(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new RangeError('Payload body is not JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RangeError('Payload body must be an object.');
    }
    const keys = Object.keys(parsed);
    if (keys.length !== BODY_KEYS.length || !BODY_KEYS.every((key) => keys.includes(key))) {
      throw new RangeError('Payload body must contain exactly the NT1 fields.');
    }
    if (parsed.v !== 1) throw new RangeError('Payload body version must be 1.');
    const body = canonicalBody({
      keyId: parsed.k,
      eventId: parsed.e,
      ticketId: parsed.t,
      sessionIds: parsed.s,
      serial: parsed.n,
      issuedAt: parsed.i,
      expiresAt: parsed.x
    });
    /* Reject a payload whose bytes are not the canonical encoding of their own
       claims. Two different byte strings must never mean the same ticket. */
    if (serializeBody(body) !== json) throw new RangeError('Payload body is not canonically encoded.');
    return body;
  }

  /* ---- encode and verify ---- */

  async function encodeTicketPayload(claims, privateKey) {
    const body = canonicalBody(claims);
    const signingInput = PREFIX + '.' + base64UrlEncode(encoder.encode(serializeBody(body)));
    const key = privateKey && privateKey.type === 'private' ? privateKey : await importSigningKey(privateKey);
    const signature = await subtle().sign(SIGN_PARAMS, key, encoder.encode(signingInput));
    const bytes = normalizeP256Signature(signature);
    if (bytes.length !== SIGNATURE_BYTES) {
      throw new Error('Expected a ' + SIGNATURE_BYTES + ' byte raw ECDSA signature.');
    }
    return signingInput + '.' + base64UrlEncode(bytes);
  }

  /* Parse only. Never trust anything this returns before verifyTicketPayload
     reports "valid" - the claims are attacker supplied until then. */
  function decodeTicketPayload(text) {
    if (typeof text !== 'string') throw new TypeError('A ticket payload must be a string.');
    const trimmed = text.trim();
    const segments = trimmed.split('.');
    if (segments.length !== 3) throw new RangeError('A ticket payload has three dot separated segments.');
    if (segments[0] !== PREFIX) throw new RangeError('Unsupported ticket payload version.');
    const json = decoder.decode(base64UrlDecode(segments[1]));
    const body = parseBody(json);
    const signature = base64UrlDecode(segments[2]);
    if (signature.length !== SIGNATURE_BYTES) throw new RangeError('Signature length is wrong for NT1.');
    return {
      version: PREFIX,
      body,
      signature,
      signingInput: segments[0] + '.' + segments[1],
      claims: Object.freeze({
        keyId: body.k,
        eventId: body.e,
        ticketId: body.t,
        sessionIds: Object.freeze(body.s.slice()),
        serial: body.n,
        issuedAt: body.i,
        expiresAt: body.x
      })
    };
  }

  /**
   * Verify a scanned payload against a set of trusted public keys.
   *
   * keys: a Map or plain object of keyId -> JWK or CryptoKey, normally taken
   * straight from the cached offline manifest.
   * now: epoch seconds. Passed explicitly so door clock policy is the
   * caller's decision and tests can pin it.
   */
  async function verifyTicketPayload(text, keys, options) {
    const settings = options || {};
    let decoded;
    try {
      decoded = decodeTicketPayload(text);
    } catch (error) {
      return {status: 'malformed', reason: error.message, claims: undefined};
    }

    if (!isLowP256Signature(decoded.signature)) {
      return {status: 'bad_signature', reason: 'P-256 signatures must use low-S canonical form.', claims: decoded.claims};
    }

    const lookup = keys instanceof Map ? keys : new Map(Object.entries(keys || {}));
    const material = lookup.get(decoded.claims.keyId);
    if (!material) {
      return {status: 'unknown_key', reason: 'No trusted key for ' + decoded.claims.keyId + '.', claims: decoded.claims};
    }

    let verifyKey;
    try {
      verifyKey = material.type === 'public' ? material : await importVerifyKey(material);
    } catch (error) {
      return {status: 'unknown_key', reason: error.message, claims: decoded.claims};
    }

    const ok = await subtle().verify(SIGN_PARAMS, verifyKey, decoded.signature, encoder.encode(decoded.signingInput));
    if (!ok) return {status: 'bad_signature', reason: 'Signature did not verify.', claims: decoded.claims};

    /* Expiry is checked only after the signature, so an expired payload is
       still proof of a real ticket - the door can tell "stale" from "forged". */
    if (settings.now != null) {
      const now = epochSeconds(settings.now, 'options.now');
      const skew = settings.clockSkewSeconds == null ? 0 : epochSeconds(settings.clockSkewSeconds, 'options.clockSkewSeconds');
      if (now > decoded.claims.expiresAt + skew) {
        return {status: 'expired', reason: 'Payload expired.', claims: decoded.claims};
      }
    }

    return {status: 'valid', reason: undefined, claims: decoded.claims};
  }

  root.NonsenseTicketPayload = Object.freeze({
    PREFIX,
    SIGNATURE_BYTES,
    VERIFY_STATUSES,
    base64UrlEncode,
    base64UrlDecode,
    normalizeP256Signature,
    isLowP256Signature,
    generateSigningKeyPair,
    keyIdFromJwk,
    importSigningKey,
    importVerifyKey,
    canonicalBody,
    serializeBody,
    encodeTicketPayload,
    decodeTicketPayload,
    verifyTicketPayload
  });
})(globalThis);

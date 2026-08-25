(function exposeTicketIssuer(root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Issuance: turn a paid order into persistent ticket and entitlement
   * records plus the signed NT1 payloads that go in the QR codes.
   *
   * This module is server side. The scanner never loads it, and it never
   * touches a private key it was not handed explicitly.
   *
   * The entitlement fan-out is the part that makes multi-session offers
   * work: one combo ticket produces one ticket record and one entitlement
   * per granted session, so redemption is keyed by (ticketId, sessionId)
   * and a two-night combo admits once on each night.
   * ------------------------------------------------------------------ */

  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ID_LENGTH = 26;
  const TIME_CHARS = 10; /* 48 bits of millisecond timestamp */

  function schema() {
    const tools = root.NonsenseTicketSchema;
    if (!tools) throw new Error('ticket-schema.js must load before ticket-issuer.js.');
    return tools;
  }

  function payloadTools() {
    const tools = root.NonsenseTicketPayload;
    if (!tools) throw new Error('ticket-payload.js must load before ticket-issuer.js.');
    return tools;
  }

  function randomBytes(length) {
    const web = root.crypto;
    if (!web || typeof web.getRandomValues !== 'function') {
      throw new Error('A cryptographic random source is required to mint identifiers.');
    }
    return web.getRandomValues(new Uint8Array(length));
  }

  /**
   * ULID-shaped identifier: 48 bits of timestamp then 80 bits of CSPRNG
   * randomness, Crockford base32. Sortable by issue time, but the ticket
   * portion is unguessable, so a ticket id leaks nothing about the order.
   */
  function newOpaqueId(nowMs) {
    const stamp = nowMs == null ? Date.now() : nowMs;
    if (!Number.isInteger(stamp) || stamp < 0) throw new RangeError('nowMs must be a nonnegative integer of milliseconds.');
    if (stamp > 0xffffffffffff) throw new RangeError('nowMs exceeds the 48 bit timestamp field.');

    let time = '';
    let remaining = stamp;
    for (let index = 0; index < TIME_CHARS; index += 1) {
      time = CROCKFORD[remaining % 32] + time;
      remaining = Math.floor(remaining / 32);
    }

    /* 16 characters of randomness, drawn one 5 bit symbol per byte. Rejection
       free because 256 is not a multiple of 32 only in the sense of bias
       across the top byte - masking to 5 bits is uniform. */
    const bytes = randomBytes(ID_LENGTH - TIME_CHARS);
    let random = '';
    bytes.forEach((byte) => { random += CROCKFORD[byte & 0x1f]; });

    return time + random;
  }

  function requireOffer(offer) {
    const validated = schema().validateOfferRecord(offer);
    if (validated.status !== 'available') {
      throw new RangeError('Cannot issue against offer ' + validated.id + ' with status ' + validated.status + '.');
    }
    return validated;
  }

  /**
   * Issue tickets for one paid order.
   *
   * Returns plain records ready for the data layer plus one signed payload
   * per ticket. Nothing is persisted here: the caller writes the records and
   * the payloads inside a single transaction, so a crash cannot leave a
   * signed QR in a buyer's inbox with no matching ticket row.
   */
  async function issueTickets(input) {
    const tools = payloadTools();
    const records = schema();
    const options = input || {};

    const order = records.validateOrderRecord(options.order);
    if (order.status !== 'paid') throw new RangeError('Only a paid order can be issued.');
    const offer = requireOffer(options.offer);
    if (offer.id !== order.offerId) throw new RangeError('order.offerId does not match the supplied offer.');
    if (offer.eventId !== order.eventId) throw new RangeError('offer and order belong to different events.');
    if (offer.facePriceCents !== order.facePriceCents || offer.feeCents !== order.feeCents) {
      throw new RangeError('order pricing does not match the offer it references.');
    }
    const expectedTotalCents = (order.facePriceCents + order.feeCents) * order.quantity;
    if (order.totalCents !== expectedTotalCents) {
      throw new RangeError('order.totalCents must equal (facePriceCents + feeCents) times quantity before issuance.');
    }

    const keyId = options.keyId;
    if (typeof keyId !== 'string' || !keyId) throw new RangeError('keyId is required to sign issued tickets.');
    if (!options.privateKey) throw new RangeError('privateKey is required to sign issued tickets.');

    const nowMs = options.nowMs == null ? Date.now() : options.nowMs;
    const issuedAt = Math.floor(nowMs / 1000);
    const expiresAt = options.expiresAt;
    if (!Number.isInteger(expiresAt) || expiresAt <= issuedAt) {
      throw new RangeError('expiresAt must be an epoch second later than issuance.');
    }

    const issuedAtIso = new Date(nowMs).toISOString();
    const tickets = [];
    const entitlements = [];
    const payloads = [];

    for (let index = 0; index < order.quantity; index += 1) {
      const ticketId = newOpaqueId(nowMs);
      const ticket = records.validateTicketRecord({
        id: ticketId,
        eventId: order.eventId,
        offerId: offer.id,
        orderId: order.id,
        holderRef: order.buyerRef,
        status: 'issued',
        issuedAt: issuedAtIso,
        serial: 1
      });
      tickets.push(ticket);

      offer.sessionIds.forEach((sessionId) => {
        entitlements.push(records.validateEntitlementRecord({
          ticketId,
          sessionId,
          status: 'active',
          grantedAt: issuedAtIso
        }));
      });

      /* eslint-disable no-await-in-loop */
      const payload = await tools.encodeTicketPayload({
        keyId,
        eventId: order.eventId,
        ticketId,
        sessionIds: offer.sessionIds.slice(),
        serial: ticket.serial,
        issuedAt,
        expiresAt
      }, options.privateKey);
      /* eslint-enable no-await-in-loop */
      payloads.push({ticketId, payload});
    }

    return {tickets, entitlements, payloads};
  }

  /**
   * Transfer a ticket at face value. The serial increments, a fresh payload
   * is signed, and the caller must publish a manifest whose minSerials entry
   * carries the new serial - that is what stops the previous holder's saved
   * screenshot from admitting anyone.
   */
  async function transferTicket(input) {
    const tools = payloadTools();
    const records = schema();
    const options = input || {};

    const ticket = records.validateTicketRecord(options.ticket);
    if (ticket.status !== 'issued' && ticket.status !== 'transferred') {
      throw new RangeError('Only an issued or transferred ticket can be transferred.');
    }
    const toHolderRef = options.toHolderRef;
    if (typeof toHolderRef !== 'string') throw new RangeError('toHolderRef is required.');
    if (toHolderRef === ticket.holderRef) throw new RangeError('A ticket cannot be transferred to its current holder.');

    if (options.sessionIds != null) {
      throw new RangeError('sessionIds must not be supplied by a transfer caller; grants come from active entitlements.');
    }
    if (!Array.isArray(options.entitlements) || !options.entitlements.length) {
      throw new RangeError('entitlements must list the active grants carried by the ticket.');
    }
    const entitlements = options.entitlements.map(records.validateEntitlementRecord);
    entitlements.forEach((entitlement) => {
      if (entitlement.ticketId !== ticket.id) {
        throw new RangeError('Every transfer entitlement must be matching the transferred ticket.');
      }
      if (entitlement.status !== 'active') {
        throw new RangeError('Every transfer entitlement must be an active entitlement.');
      }
    });
    const sessionIds = entitlements.map((entitlement) => entitlement.sessionId);
    if (new Set(sessionIds).size !== sessionIds.length) {
      throw new RangeError('Transfer entitlements must be unique per session.');
    }

    const nowMs = options.nowMs == null ? Date.now() : options.nowMs;
    const issuedAt = Math.floor(nowMs / 1000);
    const expiresAt = options.expiresAt;
    if (!Number.isInteger(expiresAt) || expiresAt <= issuedAt) {
      throw new RangeError('expiresAt must be an epoch second later than the transfer.');
    }

    const next = records.validateTicketRecord({
      ...ticket,
      holderRef: toHolderRef,
      status: 'transferred',
      serial: ticket.serial + 1
    });

    const payload = await tools.encodeTicketPayload({
      keyId: options.keyId,
      eventId: next.eventId,
      ticketId: next.id,
      sessionIds: sessionIds.slice(),
      serial: next.serial,
      issuedAt,
      expiresAt
    }, options.privateKey);

    return {ticket: next, payload, minSerial: next.serial};
  }

  root.NonsenseTicketIssuer = Object.freeze({
    newOpaqueId,
    issueTickets,
    transferTicket
  });
})(globalThis);

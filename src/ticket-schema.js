(function exposeTicketSchema(root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Persistent record schema for the Nonsense Tickets data layer.
   *
   * These are the records that must survive a page reload and a door with
   * no signal. The module is storage-engine agnostic: every validator
   * takes and returns plain JSON, so the same definitions back the issuing
   * service, the offline manifest, and the scanner PWA.
   *
   * Money is always integer cents. Instants are always stored normalized
   * to UTC ISO-8601; wall-clock presentation uses the separate IANA
   * timeZone field on the event.
   * ------------------------------------------------------------------ */

  const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
  const OPAQUE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/; /* Crockford base32, ULID shaped */
  const SCAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const EVENT_STATUSES = Object.freeze(['draft', 'onsale', 'closed', 'cancelled']);
  const SESSION_STATUSES = Object.freeze(['scheduled', 'cancelled']);
  const OFFER_STATUSES = Object.freeze(['available', 'sold_out', 'withdrawn']);
  const ORDER_STATUSES = Object.freeze(['pending', 'paid', 'refunded', 'failed']);
  const TICKET_STATUSES = Object.freeze(['issued', 'transferred', 'revoked', 'refunded']);
  const ENTITLEMENT_STATUSES = Object.freeze(['active', 'revoked']);
  const DEVICE_STATUSES = Object.freeze(['active', 'suspended', 'retired']);
  const REDEMPTION_RESULTS = Object.freeze([
    'admitted',      /* first valid scan of (ticketId, sessionId) */
    'duplicate',     /* signature valid, already redeemed for this session */
    'not_entitled',  /* signature valid, ticket grants no right to this session */
    'wrong_event',   /* signature valid, payload belongs to another event */
    'revoked',       /* signature valid, ticket or entitlement revoked */
    'superseded',    /* signature valid, but the ticket was transferred away */
    'outside_window',/* signature valid and entitled, but the door is not open */
    'expired',       /* signature valid, payload past its expiry */
    'bad_signature'  /* payload failed cryptographic verification */
  ]);

  /* ---- primitives ---- */

  function fail(Ctor, message) { throw new Ctor(message); }

  function requiredText(value, name) {
    if (typeof value !== 'string' || !value.trim()) fail(TypeError, name + ' must be a non-empty string.');
    return value.trim();
  }

  function id(value, name) {
    const text = requiredText(value, name);
    if (!ID_PATTERN.test(text)) fail(RangeError, name + ' must be a lowercase slug identifier.');
    return text;
  }

  function opaqueId(value, name) {
    const text = requiredText(value, name);
    if (!OPAQUE_PATTERN.test(text)) fail(RangeError, name + ' must be a 26 character Crockford base32 identifier.');
    return text;
  }

  function scanId(value, name) {
    const text = requiredText(value, name);
    if (!SCAN_ID_PATTERN.test(text)) fail(RangeError, name + ' must be a UUID for one physical scan attempt.');
    return text.toLowerCase();
  }

  function instant(value, name) {
    if (typeof value !== 'string' && !(value instanceof Date)) {
      fail(TypeError, name + ' must be an ISO-8601 string or Date.');
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) fail(TypeError, name + ' must be a valid timestamp.');
    return date.toISOString();
  }

  function optionalInstant(value, name) {
    return value == null ? undefined : instant(value, name);
  }

  function cents(value, name) {
    if (!Number.isInteger(value) || value < 0) fail(RangeError, name + ' must be a nonnegative integer of cents.');
    return value;
  }

  function count(value, name, min) {
    const floor = min == null ? 0 : min;
    if (!Number.isInteger(value) || value < floor) fail(RangeError, name + ' must be an integer of at least ' + floor + '.');
    return value;
  }

  function oneOf(value, allowed, name) {
    const text = requiredText(value, name);
    if (!allowed.includes(text)) fail(RangeError, name + ' must be one of: ' + allowed.join(', ') + '.');
    return text;
  }

  function timeZone(value, name) {
    const text = requiredText(value, name);
    try {
      new Intl.DateTimeFormat('en-US', {timeZone: text}).format(new Date(0));
    } catch {
      fail(RangeError, name + ' must be a valid IANA time zone.');
    }
    return text;
  }

  function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(TypeError, name + ' must be an object.');
    return value;
  }

  function uniqueIds(values, name) {
    if (!Array.isArray(values) || !values.length) fail(TypeError, name + ' must be a non-empty array.');
    const entries = values.map((value, index) => id(value, name + '[' + index + ']'));
    if (new Set(entries).size !== entries.length) fail(RangeError, name + ' must not contain duplicates.');
    return Object.freeze(entries);
  }

  /* ---- records ---- */

  function validateEventRecord(value) {
    const record = object(value, 'event');
    const startsAt = instant(record.startsAt, 'event.startsAt');
    const endsAt = instant(record.endsAt, 'event.endsAt');
    if (new Date(endsAt) <= new Date(startsAt)) fail(RangeError, 'event.endsAt must be later than event.startsAt.');
    return Object.freeze({
      id: id(record.id, 'event.id'),
      slug: id(record.slug, 'event.slug'),
      title: requiredText(record.title, 'event.title'),
      venue: requiredText(record.venue, 'event.venue'),
      timeZone: timeZone(record.timeZone, 'event.timeZone'),
      startsAt,
      endsAt,
      status: oneOf(record.status, EVENT_STATUSES, 'event.status'),
      promoterId: id(record.promoterId, 'event.promoterId')
    });
  }

  function validateSessionRecord(value) {
    const record = object(value, 'session');
    const startsAt = instant(record.startsAt, 'session.startsAt');
    const endsAt = optionalInstant(record.endsAt, 'session.endsAt');
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) {
      fail(RangeError, 'session.endsAt must be later than session.startsAt.');
    }
    const doorsAt = optionalInstant(record.doorsAt, 'session.doorsAt');
    if (doorsAt && new Date(doorsAt) > new Date(startsAt)) {
      fail(RangeError, 'session.doorsAt must not be later than session.startsAt.');
    }
    return Object.freeze({
      id: id(record.id, 'session.id'),
      eventId: id(record.eventId, 'session.eventId'),
      label: requiredText(record.label, 'session.label'),
      startsAt,
      endsAt,
      doorsAt,
      capacity: record.capacity == null ? undefined : count(record.capacity, 'session.capacity', 1),
      status: oneOf(record.status, SESSION_STATUSES, 'session.status')
    });
  }

  function validateOfferRecord(value) {
    const record = object(value, 'offer');
    return Object.freeze({
      id: id(record.id, 'offer.id'),
      eventId: id(record.eventId, 'offer.eventId'),
      label: requiredText(record.label, 'offer.label'),
      facePriceCents: cents(record.facePriceCents, 'offer.facePriceCents'),
      feeCents: cents(record.feeCents, 'offer.feeCents'),
      sessionIds: uniqueIds(record.sessionIds, 'offer.sessionIds'),
      inventory: record.inventory == null ? undefined : count(record.inventory, 'offer.inventory', 0),
      status: oneOf(record.status, OFFER_STATUSES, 'offer.status')
    });
  }

  function validateOrderRecord(value) {
    const record = object(value, 'order');
    return Object.freeze({
      id: opaqueId(record.id, 'order.id'),
      eventId: id(record.eventId, 'order.eventId'),
      offerId: id(record.offerId, 'order.offerId'),
      buyerRef: opaqueId(record.buyerRef, 'order.buyerRef'),
      quantity: count(record.quantity, 'order.quantity', 1),
      facePriceCents: cents(record.facePriceCents, 'order.facePriceCents'),
      feeCents: cents(record.feeCents, 'order.feeCents'),
      totalCents: cents(record.totalCents, 'order.totalCents'),
      status: oneOf(record.status, ORDER_STATUSES, 'order.status'),
      createdAt: instant(record.createdAt, 'order.createdAt')
    });
  }

  function validateTicketRecord(value) {
    const record = object(value, 'ticket');
    return Object.freeze({
      id: opaqueId(record.id, 'ticket.id'),
      eventId: id(record.eventId, 'ticket.eventId'),
      offerId: id(record.offerId, 'ticket.offerId'),
      orderId: opaqueId(record.orderId, 'ticket.orderId'),
      holderRef: opaqueId(record.holderRef, 'ticket.holderRef'),
      status: oneOf(record.status, TICKET_STATUSES, 'ticket.status'),
      issuedAt: instant(record.issuedAt, 'ticket.issuedAt'),
      revokedAt: optionalInstant(record.revokedAt, 'ticket.revokedAt'),
      /* Incremented on transfer. The scanner rejects a payload whose serial
         is behind the manifest, which is what invalidates the screenshot the
         previous holder kept after transferring the ticket away. */
      serial: count(record.serial, 'ticket.serial', 1)
    });
  }

  function validateEntitlementRecord(value) {
    const record = object(value, 'entitlement');
    return Object.freeze({
      ticketId: opaqueId(record.ticketId, 'entitlement.ticketId'),
      sessionId: id(record.sessionId, 'entitlement.sessionId'),
      status: oneOf(record.status, ENTITLEMENT_STATUSES, 'entitlement.status'),
      grantedAt: instant(record.grantedAt, 'entitlement.grantedAt'),
      revokedAt: optionalInstant(record.revokedAt, 'entitlement.revokedAt')
    });
  }

  function validateRedemptionRecord(value) {
    const record = object(value, 'redemption');
    const result = oneOf(record.result, REDEMPTION_RESULTS, 'redemption.result');
    /* A scan that failed cryptographic verification identifies no ticket -
       there is no trustworthy id to record, because every claim in the payload
       is attacker supplied. Those rows are still kept: a run of them at one
       entrance is the evidence that someone is working a forgery there. Every
       other result names a real ticket and must say which. */
    const unattributable = result === 'bad_signature';
    if (unattributable && record.ticketId == null) {
      return Object.freeze({
        id: opaqueId(record.id, 'redemption.id'),
        scanId: scanId(record.scanId, 'redemption.scanId'),
        ticketId: undefined,
        sessionId: id(record.sessionId, 'redemption.sessionId'),
        eventId: id(record.eventId, 'redemption.eventId'),
        deviceId: id(record.deviceId, 'redemption.deviceId'),
        result,
        scannedAt: instant(record.scannedAt, 'redemption.scannedAt'),
        recordedAt: optionalInstant(record.recordedAt, 'redemption.recordedAt'),
        manifestVersion: count(record.manifestVersion, 'redemption.manifestVersion', 1)
      });
    }
    return Object.freeze({
      id: opaqueId(record.id, 'redemption.id'),
      scanId: scanId(record.scanId, 'redemption.scanId'),
      ticketId: opaqueId(record.ticketId, 'redemption.ticketId'),
      sessionId: id(record.sessionId, 'redemption.sessionId'),
      eventId: id(record.eventId, 'redemption.eventId'),
      deviceId: id(record.deviceId, 'redemption.deviceId'),
      result: oneOf(record.result, REDEMPTION_RESULTS, 'redemption.result'),
      /* scannedAt is the door device clock; recordedAt is the server clock at
         reconciliation. They differ for every queued offline scan, and the gap
         is the audit trail when two offline devices disagree. */
      scannedAt: instant(record.scannedAt, 'redemption.scannedAt'),
      recordedAt: optionalInstant(record.recordedAt, 'redemption.recordedAt'),
      manifestVersion: count(record.manifestVersion, 'redemption.manifestVersion', 1)
    });
  }

  function validateScannerDeviceRecord(value) {
    const record = object(value, 'scannerDevice');
    return Object.freeze({
      id: id(record.id, 'scannerDevice.id'),
      eventId: id(record.eventId, 'scannerDevice.eventId'),
      label: requiredText(record.label, 'scannerDevice.label'),
      status: oneOf(record.status, DEVICE_STATUSES, 'scannerDevice.status'),
      manifestVersion: count(record.manifestVersion, 'scannerDevice.manifestVersion', 0),
      lastSyncAt: optionalInstant(record.lastSyncAt, 'scannerDevice.lastSyncAt'),
      enrolledAt: instant(record.enrolledAt, 'scannerDevice.enrolledAt')
    });
  }

  /* ---- referential integrity across the whole catalog ---- */

  function indexById(records, name) {
    const map = new Map();
    records.forEach((record) => {
      if (map.has(record.id)) fail(RangeError, name + ' ids must be unique: ' + record.id + '.');
      map.set(record.id, record);
    });
    return map;
  }

  function list(value, name) {
    if (value == null) return [];
    if (!Array.isArray(value)) fail(TypeError, name + ' must be an array.');
    return value;
  }

  function entitlementKey(ticketId, sessionId) {
    return ticketId + ' ' + sessionId;
  }

  function validateCatalog(value) {
    const input = object(value, 'catalog');

    const events = list(input.events, 'catalog.events').map(validateEventRecord);
    const sessions = list(input.sessions, 'catalog.sessions').map(validateSessionRecord);
    const offers = list(input.offers, 'catalog.offers').map(validateOfferRecord);
    const orders = list(input.orders, 'catalog.orders').map(validateOrderRecord);
    const tickets = list(input.tickets, 'catalog.tickets').map(validateTicketRecord);
    const entitlements = list(input.entitlements, 'catalog.entitlements').map(validateEntitlementRecord);
    const redemptions = list(input.redemptions, 'catalog.redemptions').map(validateRedemptionRecord);
    const devices = list(input.devices, 'catalog.devices').map(validateScannerDeviceRecord);

    const eventsById = indexById(events, 'catalog.events');
    const sessionsById = indexById(sessions, 'catalog.sessions');
    const offersById = indexById(offers, 'catalog.offers');
    const ordersById = indexById(orders, 'catalog.orders');
    const ticketsById = indexById(tickets, 'catalog.tickets');
    const devicesById = indexById(devices, 'catalog.devices');
    indexById(redemptions, 'catalog.redemption');

    const slugs = new Set();
    events.forEach((event) => {
      if (slugs.has(event.slug)) fail(RangeError, 'catalog.events slugs must be unique: ' + event.slug + '.');
      slugs.add(event.slug);
    });

    function requireRef(map, key, label) {
      if (!map.has(key)) fail(RangeError, label + ' references unknown ' + key + '.');
      return map.get(key);
    }

    sessions.forEach((session) => {
      const event = requireRef(eventsById, session.eventId, 'session ' + session.id);
      if (new Date(session.startsAt) < new Date(event.startsAt) || new Date(session.startsAt) > new Date(event.endsAt)) {
        fail(RangeError, 'session ' + session.id + ' must start within its event window.');
      }
      if (session.endsAt && new Date(session.endsAt) > new Date(event.endsAt)) {
        fail(RangeError, 'session ' + session.id + ' must end within its event window.');
      }
    });

    offers.forEach((offer) => {
      requireRef(eventsById, offer.eventId, 'offer ' + offer.id);
      offer.sessionIds.forEach((sessionId) => {
        const session = requireRef(sessionsById, sessionId, 'offer ' + offer.id);
        if (session.eventId !== offer.eventId) {
          fail(RangeError, 'offer ' + offer.id + ' grants a session from another event.');
        }
      });
    });

    orders.forEach((order) => {
      requireRef(eventsById, order.eventId, 'order ' + order.id);
      const offer = requireRef(offersById, order.offerId, 'order ' + order.id);
      if (offer.eventId !== order.eventId) fail(RangeError, 'order ' + order.id + ' mixes event and offer.');
      const expected = (order.facePriceCents + order.feeCents) * order.quantity;
      if (order.totalCents !== expected) {
        fail(RangeError, 'order ' + order.id + ' total must equal (face + fee) times quantity.');
      }
    });

    tickets.forEach((ticket) => {
      requireRef(eventsById, ticket.eventId, 'ticket ' + ticket.id);
      const offer = requireRef(offersById, ticket.offerId, 'ticket ' + ticket.id);
      const order = requireRef(ordersById, ticket.orderId, 'ticket ' + ticket.id);
      if (offer.eventId !== ticket.eventId) fail(RangeError, 'ticket ' + ticket.id + ' mixes event and offer.');
      if (order.eventId !== ticket.eventId) fail(RangeError, 'ticket ' + ticket.id + ' mixes event and order.');
      if (ticket.status === 'revoked' && !ticket.revokedAt) {
        fail(RangeError, 'ticket ' + ticket.id + ' is revoked without a revokedAt.');
      }
    });

    const entitlementKeys = new Set();
    entitlements.forEach((entitlement) => {
      const ticket = requireRef(ticketsById, entitlement.ticketId, 'entitlement');
      const session = requireRef(sessionsById, entitlement.sessionId, 'entitlement');
      if (session.eventId !== ticket.eventId) {
        fail(RangeError, 'entitlement grants ' + entitlement.sessionId + ' from another event.');
      }
      const key = entitlementKey(entitlement.ticketId, entitlement.sessionId);
      if (entitlementKeys.has(key)) {
        fail(RangeError, 'entitlements must be unique per (ticketId, sessionId).');
      }
      entitlementKeys.add(key);
    });

    /* The core admission invariant: at most one admitted redemption per
       (ticketId, sessionId). Rejected scans are kept for audit and may repeat. */
    const admitted = new Set();
    const redemptionScanIds = new Set();
    redemptions.forEach((redemption) => {
      if (redemption.ticketId == null) {
        /* Unattributable forgery evidence: no ticket to resolve, and it can
           never have admitted anyone. */
        requireRef(sessionsById, redemption.sessionId, 'redemption ' + redemption.id);
        return;
      }
      const ticket = requireRef(ticketsById, redemption.ticketId, 'redemption ' + redemption.id);
      const session = requireRef(sessionsById, redemption.sessionId, 'redemption ' + redemption.id);
      const device = devicesById.get(redemption.deviceId);
      if (!device) fail(RangeError, 'redemption ' + redemption.id + ' references unknown device ' + redemption.deviceId + '.');
      if (redemptionScanIds.has(redemption.scanId)) fail(RangeError, 'redemption scanIds must be unique.');
      redemptionScanIds.add(redemption.scanId);
      if (ticket.eventId !== redemption.eventId) {
        fail(RangeError, 'redemption ' + redemption.id + ' mixes ticket and event.');
      }
      if (session.eventId !== redemption.eventId) {
        fail(RangeError, 'redemption ' + redemption.id + ' mixes session and event.');
      }
      if (device.eventId !== redemption.eventId) {
        fail(RangeError, 'redemption ' + redemption.id + ' mixes device and event.');
      }
      if (redemption.result !== 'admitted') return;
      const key = entitlementKey(redemption.ticketId, redemption.sessionId);
      if (!entitlementKeys.has(key)) {
        fail(RangeError, 'redemption ' + redemption.id + ' admitted a ticket with no entitlement.');
      }
      if (admitted.has(key)) {
        fail(RangeError, 'at most one admitted redemption is allowed per (ticketId, sessionId).');
      }
      admitted.add(key);
    });

    devices.forEach((device) => requireRef(eventsById, device.eventId, 'device ' + device.id));

    return Object.freeze({
      events: Object.freeze(events),
      sessions: Object.freeze(sessions),
      offers: Object.freeze(offers),
      orders: Object.freeze(orders),
      tickets: Object.freeze(tickets),
      entitlements: Object.freeze(entitlements),
      redemptions: Object.freeze(redemptions),
      devices: Object.freeze(devices)
    });
  }

  root.NonsenseTicketSchema = Object.freeze({
    EVENT_STATUSES,
    SESSION_STATUSES,
    OFFER_STATUSES,
    ORDER_STATUSES,
    TICKET_STATUSES,
    ENTITLEMENT_STATUSES,
    DEVICE_STATUSES,
    REDEMPTION_RESULTS,
    entitlementKey,
    validateEventRecord,
    validateSessionRecord,
    validateOfferRecord,
    validateOrderRecord,
    validateTicketRecord,
    validateEntitlementRecord,
    validateRedemptionRecord,
    validateScannerDeviceRecord,
    validateCatalog
  });
})(globalThis);

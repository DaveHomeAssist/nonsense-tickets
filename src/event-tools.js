(function exposeEventTools(root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const encoder = new TextEncoder();

  function parseInstant(value, name) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError(name + ' must be a valid timestamp.');
    }
    return date;
  }

  function validateEvent(event) {
    if (!event || typeof event !== 'object') {
      throw new TypeError('Event must be an object.');
    }
    const start = parseInstant(event.startsAt, 'startsAt');
    const end = parseInstant(event.endsAt, 'endsAt');
    if (end <= start) {
      throw new RangeError('endsAt must be later than startsAt.');
    }
    if (typeof event.timeZone !== 'string' || !event.timeZone.trim()) {
      throw new RangeError('timeZone must be a valid IANA time zone.');
    }
    try {
      new Intl.DateTimeFormat('en-US', {timeZone:event.timeZone}).format(start);
    } catch {
      throw new RangeError('timeZone must be a valid IANA time zone.');
    }

    const sessions = validateSessions(event.sessions, event.timeZone, start, end);
    const offers = validateOffers(event.offers, sessions);
    const checkout = validateCheckout(event.checkout);
    return {start, end, timeZone:event.timeZone, sessions, offers, checkout};
  }

  function requiredText(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(name + ' must be a non-empty string.');
    }
    return value.trim();
  }

  function validateSessions(value, timeZone, eventStart, eventEnd) {
    if (value == null) return [];
    if (!Array.isArray(value) || !value.length) {
      throw new TypeError('sessions must be a non-empty array when provided.');
    }
    const ids = new Set();
    return value.map((session, index) => {
      if (!session || typeof session !== 'object') {
        throw new TypeError('sessions[' + index + '] must be an object.');
      }
      const id = requiredText(session.id, 'sessions[' + index + '].id');
      if (ids.has(id)) throw new RangeError('session IDs must be unique.');
      ids.add(id);
      const label = requiredText(session.label, 'sessions[' + index + '].label');
      const start = parseInstant(session.startsAt, 'sessions[' + index + '].startsAt');
      const end = session.endsAt == null ? undefined : parseInstant(session.endsAt, 'sessions[' + index + '].endsAt');
      if (end && end <= start) {
        throw new RangeError('sessions[' + index + '].endsAt must be later than startsAt.');
      }
      if (start < eventStart || start > eventEnd || (end && end > eventEnd)) {
        throw new RangeError('sessions[' + index + '] must fall within the event range.');
      }
      return Object.freeze({id, label, start, end, timeZone});
    });
  }

  function validateOffers(value, sessions) {
    if (value == null) return [];
    if (!sessions.length) throw new RangeError('offers require sessions.');
    if (!Array.isArray(value) || !value.length) {
      throw new TypeError('offers must be a non-empty array when provided.');
    }
    const sessionIds = new Set(sessions.map((session) => session.id));
    const offerIds = new Set();
    return value.map((offer, index) => {
      if (!offer || typeof offer !== 'object') {
        throw new TypeError('offers[' + index + '] must be an object.');
      }
      const id = requiredText(offer.id, 'offers[' + index + '].id');
      if (offerIds.has(id)) throw new RangeError('offer IDs must be unique.');
      offerIds.add(id);
      const label = requiredText(offer.label, 'offers[' + index + '].label');
      if (!Number.isFinite(offer.facePrice) || offer.facePrice < 0) {
        throw new RangeError('offers[' + index + '].facePrice must be a nonnegative number.');
      }
      if (!Number.isFinite(offer.externalTotal) || offer.externalTotal < offer.facePrice) {
        throw new RangeError('offers[' + index + '].externalTotal must be at least facePrice.');
      }
      if (!Array.isArray(offer.sessionIds) || !offer.sessionIds.length) {
        throw new RangeError('offers[' + index + '].sessionIds must contain at least one session ID.');
      }
      const grants = offer.sessionIds.map((sessionId) => requiredText(sessionId, 'offer session ID'));
      if (new Set(grants).size !== grants.length) {
        throw new RangeError('offer session IDs must be unique.');
      }
      grants.forEach((sessionId) => {
        if (!sessionIds.has(sessionId)) throw new RangeError('offer references an unknown session.');
      });
      return Object.freeze({id, label, facePrice:offer.facePrice, externalTotal:offer.externalTotal, sessionIds:Object.freeze(grants)});
    });
  }

  function validateCheckout(value) {
    if (value == null) return undefined;
    if (!value || typeof value !== 'object' || value.mode !== 'external') {
      throw new RangeError('checkout.mode must be external when checkout is provided.');
    }
    const provider = requiredText(value.provider, 'checkout.provider');
    let url;
    try {
      url = new URL(value.url);
    } catch {
      throw new TypeError('checkout.url must be a valid HTTPS URL.');
    }
    if (url.protocol !== 'https:') throw new RangeError('checkout.url must be a valid HTTPS URL.');
    return Object.freeze({mode:'external', provider, url:url.href});
  }

  function parts(date, timeZone, options) {
    const values = {};
    new Intl.DateTimeFormat('en-US', {timeZone, ...options}).formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') values[part.type] = part.value;
    });
    return values;
  }

  function dayLabel(date, timeZone) {
    const value = parts(date, timeZone, {weekday:'short', month:'short', day:'2-digit'});
    return (value.weekday + ' ' + value.month + ' ' + value.day).toUpperCase();
  }

  function timeLabel(date, timeZone) {
    const value = parts(date, timeZone, {hour:'numeric', minute:'2-digit', hour12:true});
    return value.hour + (value.minute === '00' ? '' : ':' + value.minute) + value.dayPeriod.toUpperCase();
  }

  function formatEventDate(event) {
    const {start, end, timeZone, sessions} = validateEvent(event);
    if (sessions.length > 1) {
      const day = sessions.map((session) => dayLabel(session.start, timeZone)).join(' + ');
      const times = [...new Set(sessions.map((session) => timeLabel(session.start, timeZone)))];
      const time = times.length === 1 ? times[0] + ' EACH NIGHT' : times.join(' + ');
      return {full:sessions.length + ' NIGHTS · ' + day + ' · ' + time, day, time};
    }
    const day = dayLabel(start, timeZone);
    const time = timeLabel(start, timeZone) + '–' + timeLabel(end, timeZone);
    return {full:day + ' · ' + time, day, time};
  }

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en-US')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function matchesEvent(event, criteria = {}) {
    let validated;
    try {
      validated = validateEvent(event);
    } catch {
      return false;
    }

    const query = normalize(criteria.query);
    const tokens = query ? query.split(' ') : [];
    const haystack = normalize([
      event.title,
      event.venue,
      event.genre,
      ...(Array.isArray(event.lineup) ? event.lineup : []),
      ...(Array.isArray(event.sessions) ? event.sessions.map((session) => session.label) : []),
      ...(Array.isArray(event.offers) ? event.offers.map((offer) => offer.label) : [])
    ].join(' '));
    if (!tokens.every((token) => haystack.includes(token))) return false;

    const genre = normalize(criteria.genre || 'all');
    if (genre !== 'all' && normalize(event.genre) !== genre) return false;

    const dateRange = criteria.dateRange || 'all';
    if (dateRange === 'all') return true;
    const now = criteria.now == null ? Date.now() : new Date(criteria.now).getTime();
    if (!Number.isFinite(now)) return false;
    const delta = validated.start.getTime() - now;
    if (dateRange === 'next7') return delta >= 0 && delta < 7 * DAY_MS;
    if (dateRange === 'next30') return delta >= 0 && delta < 30 * DAY_MS;
    if (dateRange === 'later') return delta >= 30 * DAY_MS;
    return false;
  }

  function filterEvents(events, criteria = {}) {
    if (!Array.isArray(events)) throw new TypeError('events must be an array.');
    return events.filter((event) => matchesEvent(event, criteria));
  }

  function slug(value) {
    return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  }

  function utcStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function localDateStamp(date, timeZone) {
    const value = parts(date, timeZone, {year:'numeric', month:'2-digit', day:'2-digit'});
    return value.year + '-' + value.month + '-' + value.day;
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function foldLine(line) {
    const segments = [];
    let current = '';
    let limit = 75;
    for (const character of line) {
      if (current && encoder.encode(current + character).length > limit) {
        segments.push(current);
        current = character;
        limit = 74;
      } else {
        current += character;
      }
    }
    segments.push(current);
    return segments.map((segment, index) => (index ? ' ' : '') + segment).join('\r\n');
  }

  function buildCalendar(event, options = {}) {
    const {start, end, timeZone, sessions} = validateEvent(event);
    if (sessions.some((session) => !session.end)) {
      throw new RangeError('Every session needs an exact session end time before calendar export.');
    }
    const generatedAt = parseInstant(options.generatedAt ?? new Date(), 'generatedAt');
    const description = [
      event.note,
      Array.isArray(event.lineup) && event.lineup.length ? 'Lineup: ' + event.lineup.join(', ') : ''
    ].filter(Boolean).join('\n');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Nonsense Tickets//Event Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-TIMEZONE:' + timeZone,
      'BEGIN:VEVENT',
      'UID:' + slug(event.title) + '-' + utcStamp(start) + '@nonsense.tickets',
      'DTSTAMP:' + utcStamp(generatedAt),
      'DTSTART:' + utcStamp(start),
      'DTEND:' + utcStamp(end),
      'SUMMARY:' + escapeText(event.title),
      'LOCATION:' + escapeText(event.venue),
      'DESCRIPTION:' + escapeText(description),
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  function calendarFilename(event) {
    const {start, timeZone} = validateEvent(event);
    return slug(event.title) + '-' + localDateStamp(start, timeZone) + '.ics';
  }

  root.NonsenseEventTools = Object.freeze({
    validateEvent,
    formatEventDate,
    matchesEvent,
    filterEvents,
    buildCalendar,
    calendarFilename
  });
})(globalThis);

(function scannerApp(root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Door scanner shell.
   *
   * Everything that decides admission lives in scanner-core.js. This file
   * only moves bytes: camera frames in, decisions out, queue to disk.
   *
   * Deliberately absent: any issuance or signing code. A door device holds
   * public keys only, so a stolen or lost scanner cannot mint a ticket.
   * ------------------------------------------------------------------ */

  const STORAGE = {
    publisher: 'nonsense.scanner.publisherKey',
    manifest: 'nonsense.scanner.manifest',
    version: 'nonsense.scanner.manifestVersion',
    device: 'nonsense.scanner.deviceId',
    queue: 'nonsense.scanner.queue',
    session: 'nonsense.scanner.session'
  };

  const $ = (selector) => document.querySelector(selector);
  const el = {
    verdict: $('[data-verdict]'),
    verdictText: $('[data-verdict-text]'),
    verdictDetail: $('[data-verdict-detail]'),
    event: $('[data-event]'),
    manifestVersion: $('[data-manifest-version]'),
    admitted: $('[data-admitted]'),
    queued: $('[data-queued]'),
    setup: $('[data-setup]'),
    door: $('[data-door]'),
    sync: $('[data-sync]'),
    session: $('[data-session]'),
    video: $('[data-video]'),
    cameraNote: $('[data-camera-note]'),
    syncNote: $('[data-sync-note]')
  };

  let scanner = null;
  let manifest = null;
  let stream = null;
  let decoder = null;
  let scanning = false;
  let lastPayload = '';
  let lastPayloadAt = 0;

  /* ---- storage helpers. Every read is defensive: a door device that
     cannot read its own storage must still say so rather than crash. ---- */

  function read(key) {
    try {
      return root.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      root.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    try {
      root.localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  }

  function deviceId() {
    let id = read(STORAGE.device);
    if (!id) {
      const bytes = root.crypto.getRandomValues(new Uint8Array(4));
      id = 'door-' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      write(STORAGE.device, id);
    }
    return id;
  }

  function loadQueue() {
    try {
      const parsed = JSON.parse(read(STORAGE.queue) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveQueue(entries) {
    if (!write(STORAGE.queue, JSON.stringify(entries))) {
      note(el.syncNote, 'Warning: this device could not save the scan queue to storage.');
    }
  }

  function note(target, message) {
    if (target) target.textContent = message || '';
  }

  /* ---- verdict rendering ---- */

  const COPY = {
    admitted: {text: 'ADMIT', tone: 'admitted'},
    duplicate: {text: 'ALREADY IN', tone: 'rejected'},
    not_entitled: {text: 'WRONG NIGHT', tone: 'rejected'},
    wrong_event: {text: 'WRONG SHOW', tone: 'rejected'},
    revoked: {text: 'REVOKED', tone: 'rejected'},
    superseded: {text: 'TRANSFERRED', tone: 'rejected'},
    outside_window: {text: 'DOORS CLOSED', tone: 'caution'},
    expired: {text: 'EXPIRED', tone: 'caution'},
    bad_signature: {text: 'NOT A TICKET', tone: 'rejected'}
  };

  function showVerdict(decision) {
    const copy = COPY[decision.result] || {text: decision.result.toUpperCase(), tone: 'rejected'};
    el.verdict.className = 'verdict ' + copy.tone;
    el.verdictText.textContent = copy.text;
    const parts = [];
    if (decision.ticketId) parts.push(decision.ticketId);
    if (decision.reason) parts.push(decision.reason);
    el.verdictDetail.textContent = parts.join(' · ') || 'Scanned.';

    if (decision.result === 'admitted' && root.navigator.vibrate) root.navigator.vibrate(40);
    if (decision.result !== 'admitted' && root.navigator.vibrate) root.navigator.vibrate([60, 60, 60]);
  }

  function showStatus(text, detail, tone) {
    el.verdict.className = 'verdict' + (tone ? ' ' + tone : '');
    el.verdictText.textContent = text;
    el.verdictDetail.textContent = detail || '';
  }

  function refreshCounters() {
    el.admitted.textContent = scanner ? String(scanner.admittedCount()) : '0';
    el.queued.textContent = String(loadQueue().length);
    el.event.textContent = manifest ? manifest.eventId : '—';
    el.manifestVersion.textContent = manifest ? String(manifest.version) : '—';
  }

  /* ---- manifest installation ---- */

  async function installManifest(publisherJwkText, documentText) {
    let publisherJwk;
    try {
      publisherJwk = JSON.parse(publisherJwkText);
    } catch {
      showStatus('Bad key', 'The publisher key is not valid JSON.', 'rejected');
      return false;
    }

    const installed = Number(read(STORAGE.version) || 0);
    const result = await root.NonsenseTicketManifest.verifyManifest(
      documentText.trim(),
      {publisher: publisherJwk},
      {now: Math.floor(Date.now() / 1000), installedVersion: installed}
    );

    if (result.status !== 'valid') {
      showStatus('Manifest refused', result.status + ': ' + (result.reason || ''), 'rejected');
      return false;
    }

    manifest = result.manifest;
    write(STORAGE.publisher, JSON.stringify(publisherJwk));
    write(STORAGE.manifest, documentText.trim());
    write(STORAGE.version, String(manifest.version));
    startScannerCore();
    return true;
  }

  function startScannerCore() {
    scanner = root.NonsenseScannerCore.createScanner({manifest, deviceId: deviceId()});
    /* Restore admissions so a reopened device still catches duplicates.
       Key the restore on the event, not the manifest version: installing a
       newer manifest mid-show (a revocation, a transfer) must not forget who
       is already inside, or the same ticket admits again at this door. Scans
       for another event stay in the queue for export but never seed this
       event's duplicate map. */
    scanner.restore(loadQueue().filter((entry) => entry.eventId === manifest.eventId));

    el.session.innerHTML = '';
    manifest.sessions.forEach((session) => {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = session.label + ' (' + session.id + ')';
      el.session.appendChild(option);
    });
    const remembered = read(STORAGE.session);
    if (remembered && manifest.sessions.some((session) => session.id === remembered)) {
      el.session.value = remembered;
    }

    el.setup.classList.add('hidden');
    el.door.classList.remove('hidden');
    el.sync.classList.remove('hidden');
    showStatus('Ready', manifest.title || manifest.eventId, null);
    refreshCounters();
  }

  /* ---- evaluation ---- */

  async function check(payloadText, fromCamera) {
    if (!scanner) return;
    const text = String(payloadText || '').trim();
    if (!text) return;

    const sessionId = el.session.value;
    const now = Date.now();

    /* Debounce repeated camera frames only, and key the debounce on the
       session as well as the payload.
       Manual entry is a deliberate act and always evaluates: swallowing it
       would leave the previous verdict on screen, which reads as a fresh
       decision for a scan that never happened. Keying on the session as
       well means walking a combo ticket from one door to the other is
       still evaluated for the second night. */
    if (fromCamera) {
      const fingerprint = sessionId + ' ' + text;
      if (fingerprint === lastPayload && now - lastPayloadAt < 2500) return;
      lastPayload = fingerprint;
      lastPayloadAt = now;
    }

    write(STORAGE.session, sessionId);

    let decision;
    try {
      decision = await scanner.evaluate(text, {sessionId, now: Math.floor(now / 1000)});
    } catch (error) {
      showStatus('Scanner error', error.message, 'rejected');
      return;
    }

    const queue = loadQueue();
    queue.push(decision);
    saveQueue(queue);
    showVerdict(decision);
    refreshCounters();
  }

  /* ---- camera ---- */

  async function startCamera() {
    if (!root.isSecureContext) {
      note(el.cameraNote, 'Camera access needs HTTPS or localhost. Use manual entry here.');
      return;
    }
    if (!root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia) {
      note(el.cameraNote, 'This browser exposes no camera API. Use manual entry.');
      return;
    }
    try {
      decoder = await root.NonsenseQrDecoder.createDecoder();
      stream = await root.navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment', width: {ideal: 1280}, height: {ideal: 720}}
      });
    } catch (error) {
      decoder = null;
      note(el.cameraNote, 'Camera unavailable: ' + error.message + '. Use manual entry.');
      return;
    }

    el.video.srcObject = stream;
    el.video.classList.remove('hidden');
    await el.video.play();
    scanning = true;
    $('[data-start]').disabled = true;
    $('[data-stop]').disabled = false;
    const decoderName = decoder.kind === 'native' ? 'native QR detection' : 'offline jsQR fallback';
    note(el.cameraNote, 'Scanning with ' + decoderName + '. Hold the ticket steady in frame.');
    loop();
  }

  async function loop() {
    if (!scanning) return;
    try {
      const payload = await decoder.decode(el.video);
      if (payload) await check(payload, true);
    } catch {
      /* A dropped frame is normal; keep the loop alive. */
    }
    root.requestAnimationFrame(loop);
  }

  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    decoder = null;
    el.video.classList.add('hidden');
    el.video.srcObject = null;
    $('[data-start]').disabled = false;
    $('[data-stop]').disabled = true;
    note(el.cameraNote, 'Camera stopped.');
  }

  /* ---- queue export ---- */

  function exportQueue() {
    const queue = loadQueue();
    if (!queue.length) {
      note(el.syncNote, 'Nothing queued.');
      return;
    }
    const batch = {
      deviceId: deviceId(),
      eventId: manifest ? manifest.eventId : null,
      manifestVersion: manifest ? manifest.version : null,
      exportedAt: new Date().toISOString(),
      scans: queue
    };
    const blob = new Blob([JSON.stringify(batch, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'door-batch-' + deviceId() + '-' + Date.now() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    note(el.syncNote, 'Exported ' + queue.length + ' scans. Keep the queue until the server confirms receipt.');
  }

  /* ---- wiring ---- */

  function boot() {
    $('[data-install]').addEventListener('click', async () => {
      await installManifest($('#publisher-key').value, $('#manifest-doc').value);
      refreshCounters();
    });

    $('[data-forget]').addEventListener('click', () => {
      if (!root.confirm('Reset this device? The scan queue and installed manifest are erased.')) return;
      Object.values(STORAGE).forEach(remove);
      root.location.reload();
    });

    $('[data-start]').addEventListener('click', startCamera);
    $('[data-stop]').addEventListener('click', stopCamera);
    $('[data-check]').addEventListener('click', () => {
      const field = $('#manual');
      check(field.value);
      field.value = '';
    });
    $('[data-export]').addEventListener('click', exportQueue);
    $('[data-clear]').addEventListener('click', () => {
      if (!root.confirm('Clear the queue? Do this only after the server has confirmed receipt.')) return;
      saveQueue([]);
      refreshCounters();
      note(el.syncNote, 'Queue cleared.');
    });

    /* Re-install the cached manifest so the device works with no signal. */
    const publisher = read(STORAGE.publisher);
    const document_ = read(STORAGE.manifest);
    if (publisher && document_) {
      installManifest(publisher, document_).then((ok) => {
        if (!ok) showStatus('Manifest rejected', 'The cached manifest no longer verifies. Re-enroll this device.', 'rejected');
        refreshCounters();
      });
    } else {
      refreshCounters();
    }

    if ('serviceWorker' in root.navigator) {
      root.navigator.serviceWorker.register('./sw.js').catch(() => {
        note(el.cameraNote, 'Offline caching unavailable; keep this tab open at the door.');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);

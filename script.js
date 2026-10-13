/* AetherDrop: static PeerJS transport. No server, acknowledgments, or live-stream claims. */
(() => {
  'use strict';

  const CHUNK_SIZE = 64 * 1024;
  const MAX_INBOUND_BYTES = 512 * 1024 * 1024;
  const MAX_FILES = 1000;
  const MAX_PIN_ATTEMPTS = 6;
  const PAIR_TIMEOUT = 15000;
  const STALL_TIMEOUT = 30000;
  const PIN_PATTERN = /^\d{6}$/;
  const PEER_PATTERN = /^aether-pin-\d{6}$/;
  const $ = id => document.getElementById(id);
  const ui = {};
  [
    'statusPill', 'statusText', 'myPeerId', 'targetPeerId', 'copyIdBtn',
    'showQrBtn', 'scanQrBtn', 'connectBtn', 'connectedPeerBadge', 'dropZone',
    'fileInput', 'browseFilesBtn', 'disconnectBtn', 'cancelPairingBtn',
    'cancelTransferBtn', 'clearInboundBtn', 'pairingOverlay', 'pairingModalTitle',
    'pairingModalSub', 'transferOverlay', 'transferModalTitle',
    'transferModalFileName', 'transferProgressBar', 'transferPercent',
    'transferSpeed', 'transferBytes', 'qrModal', 'closeQrBtn', 'qrCanvas',
    'qrPinLabel', 'scannerModal', 'closeScannerBtn', 'cameraPreview',
    'liveVideoPlayer', 'videoPlaceholder', 'mediaFileName', 'inboundFileList',
    'inboundEmpty', 'inboundCountBadge', 'offlineScreen', 'retryOfflineBtn', 'toastRegion'
  ].forEach(id => { ui[id] = $(id); });

  let peer = null;
  let peerGeneration = 0;
  let nodeTimer = null;
  let reconnectTimer = null;
  let currentPin = '';
  let nodeFailure = false;
  let active = null;
  let sender = null;
  let sendQueue = [];
  let incoming = null;
  let scanner = null;
  let scanIntent = 0;
  let retainedBytes = 0;
  let inboundCount = 0;
  let autoPairChecked = false;
  let shuttingDown = false;
  const objectUrls = new Set();
  const dialogs = [];
  const dialogOpeners = new Map();

  function toast(message, error = false) {
    if (shuttingDown) return;
    const item = document.createElement('div');
    item.className = `toast ${error ? 'error' : 'success'}`;
    item.textContent = message;
    ui.toastRegion.append(item);
    while (ui.toastRegion.children.length > 5) ui.toastRegion.firstElementChild.remove();
    setTimeout(() => item.remove(), error ? 12000 : 7000);
  }

  function focusable(dialog) {
    return Array.from(dialog.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), ' +
      'textarea:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.closest('[hidden]') && element.getClientRects().length);
  }

  function openDialog(dialog) {
    if (!dialog.hidden) return;
    dialogOpeners.set(dialog, document.activeElement);
    dialog.hidden = false;
    dialogs.push(dialog);
    requestAnimationFrame(() => {
      if (dialogs[dialogs.length - 1] !== dialog || dialog.hidden) return;
      dialog.tabIndex = -1;
      (focusable(dialog)[0] || dialog).focus();
    });
  }

  function closeDialog(dialog) {
    const wasTop = dialogs[dialogs.length - 1] === dialog;
    dialog.hidden = true;
    const index = dialogs.indexOf(dialog);
    if (index !== -1) dialogs.splice(index, 1);
    const opener = dialogOpeners.get(dialog);
    dialogOpeners.delete(dialog);
    if (!wasTop || shuttingDown) return;
    const top = dialogs[dialogs.length - 1];
    if (top) (focusable(top)[0] || top).focus();
    else if (opener && opener.isConnected && !opener.disabled && !opener.closest('[hidden]')) opener.focus();
    else (active ? ui.disconnectBtn : ui.targetPeerId).focus();
  }

  function renderStatus() {
    const paired = Boolean(active && active.open);
    let state = 'connecting';
    let label = 'Connecting to signaling…';
    if (!navigator.onLine) { state = 'offline'; label = 'Offline'; }
    else if (paired) { state = 'paired'; label = 'Paired'; }
    else if (active) { label = 'Pairing…'; }
    else if (nodeFailure) { state = 'error'; label = 'Connection unavailable — retry'; }
    else if (peer && peer.open) { state = 'online'; label = 'Ready to pair'; }
    ui.statusPill.dataset.state = state;
    ui.statusText.textContent = label;
    const dot = ui.statusPill.querySelector('.status-dot');
    if (dot) dot.classList.toggle('connected', paired);
    document.body.dataset.connected = String(paired);
    ui.connectedPeerBadge.textContent = paired ? `Peer: ${active.conn.peer.slice(11)}` : 'Not connected';
    ui.connectedPeerBadge.hidden = !paired;
    ui.disconnectBtn.hidden = !paired;
    ui.disconnectBtn.disabled = !active;
    const ready = Boolean(navigator.onLine && peer && peer.open);
    ui.connectBtn.disabled = !ready || Boolean(active);
    ui.showQrBtn.disabled = !ready || Boolean(active);
    ui.copyIdBtn.disabled = !ready;
    ui.scanQrBtn.disabled = !ready || Boolean(active);
    ui.browseFilesBtn.disabled = !paired;
    ui.fileInput.disabled = !paired;
  }

  function randomPin() {
    // Rejection sampling avoids modulo bias while retaining the original six-digit range.
    const range = 900000;
    const limit = Math.floor(0x100000000 / range) * range;
    const sample = new Uint32Array(1);
    do { window.crypto.getRandomValues(sample); } while (sample[0] >= limit);
    return String(100000 + sample[0] % range);
  }

  function nodeError(message) {
    clearTimeout(nodeTimer);
    nodeFailure = true;
    renderStatus();
    toast(message, true);
    if (!active) openDialog(ui.offlineScreen);
  }

  function destroyPeer() {
    clearTimeout(nodeTimer);
    clearTimeout(reconnectTimer);
    const old = peer;
    peer = null;
    peerGeneration++;
    if (old && !old.destroyed) {
      try { old.destroy(); } catch (_) { /* Already closing. */ }
    }
  }

  function initPeer(attempt = 0) {
    if (active || shuttingDown) return;
    destroyPeer();
    currentPin = '';
    ui.myPeerId.value = '------';
    nodeFailure = false;
    renderStatus();
    if (!navigator.onLine) { openDialog(ui.offlineScreen); return; }
    closeDialog(ui.offlineScreen);
    if (typeof window.Peer !== 'function') {
      nodeError('The connection library did not load. Check your connection, then reload this page.');
      return;
    }
    let instance;
    try {
      currentPin = randomPin();
      instance = new window.Peer(`aether-pin-${currentPin}`, {
        debug: 0,
        config: { iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ] }
      });
      peer = instance;
    } catch (_) {
      nodeError('Could not create a secure device PIN or start the connection. Please retry.');
      return;
    }
    const generation = peerGeneration;
    const current = () => peer === instance && peerGeneration === generation && !shuttingDown;
    let reconnectAttempts = 0;
    nodeTimer = setTimeout(() => {
      if (!current() || instance.open) return;
      destroyPeer();
      nodeError('Signaling timed out. Check your connection and retry.');
    }, PAIR_TIMEOUT);
    instance.on('open', () => {
      if (!current()) return;
      clearTimeout(nodeTimer);
      clearTimeout(reconnectTimer);
      nodeFailure = false;
      reconnectAttempts = 0;
      ui.myPeerId.value = currentPin;
      closeDialog(ui.offlineScreen);
      renderStatus();
      if (!autoPairChecked) {
        autoPairChecked = true;
        const pin = new URLSearchParams(window.location.search).get('pair');
        if (pin !== null) {
          ui.targetPeerId.value = pin;
          initiateConnect(pin);
        }
      }
    });
    instance.on('connection', conn => {
      if (!current() || active || !PEER_PATTERN.test(conn.peer) || conn.peer === instance.id) {
        // A second peer must never replace a pending or established connection.
        conn.on('open', () => { try { conn.close(); } catch (_) { /* Closed. */ } });
        conn.on('error', () => {});
        try { conn.close(); } catch (_) { /* Closed. */ }
        if (current() && active) toast('Another pairing request was declined. Disconnect before switching peers.', true);
        return;
      }
      bindConnection(conn);
    });
    instance.on('error', error => {
      if (!current()) return;
      if (error && error.type === 'unavailable-id' && !active) {
        destroyPeer();
        if (attempt + 1 < MAX_PIN_ATTEMPTS) initPeer(attempt + 1);
        else nodeError('Could not reserve a PIN after six attempts. Please retry.');
      } else if (error && ['peer-unavailable', 'webrtc'].includes(error.type)) {
        // Peer-level errors have no reliable connection identity: the scoped timeout owns cancellation.
        toast('The peer could not be reached. Verify its PIN and network; cancel pairing to try again.', true);
      } else {
        nodeError('The signaling service is unavailable. An existing direct connection may still work.');
      }
    });
    instance.on('disconnected', () => {
      if (!current() || !navigator.onLine) return;
      renderStatus();
      const retry = () => {
        if (!current() || instance.open) return;
        if (++reconnectAttempts > 2) {
          nodeError('Signaling reconnection failed. Disconnect any active peer, then retry.');
          return;
        }
        try { instance.reconnect(); } catch (_) { /* Bounded retry below. */ }
        reconnectTimer = setTimeout(retry, 5000);
      };
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(retry, 1000);
    });
    instance.on('close', () => {
      if (!current()) return;
      if (active) disconnect('The connection service closed. Pair again to continue.', true);
      nodeError('The connection service closed. Please retry.');
    });
  }

  function showPairing(pin) {
    ui.pairingModalTitle.textContent = 'Connecting to peer';
    ui.pairingModalSub.textContent = `Negotiating a WebRTC channel with PIN ${pin}…`;
    openDialog(ui.pairingOverlay);
  }

  function hidePairing() { closeDialog(ui.pairingOverlay); }

  function bindConnection(conn) {
    if (active) {
      try { conn.close(); } catch (_) { /* Rejected connection. */ }
      return;
    }
    const state = { conn, open: false, timer: null, closed: false };
    active = state;
    showPairing(conn.peer.slice(11));
    renderStatus();
    state.timer = setTimeout(() => {
      if (active === state && !state.open) {
        toast('Pairing timed out. Verify the remote six-digit PIN.', true);
        disconnect('Pairing timed out.', true);
      }
    }, PAIR_TIMEOUT);
    conn.on('open', () => {
      if (active !== state || state.closed) return;
      clearTimeout(state.timer);
      state.open = true;
      hidePairing();
      closeDialog(ui.qrModal);
      void stopScanner();
      renderStatus();
    });
    conn.on('data', data => {
      if (active === state && !state.closed) handleIncomingData(data);
    });
    conn.on('close', () => {
      if (active === state) handleConnectionClosed(state, 'Peer disconnected.');
    });
    conn.on('error', () => {
      if (active === state && !state.closed) toast('The direct data channel reported an error.', true);
    });
  }

  function handleConnectionClosed(state, message) {
    if (active !== state) return;
    clearTimeout(state.timer);
    state.closed = true;
    cancelTransfers(message, false);
    active = null;
    hidePairing();
    renderStatus();
    if (message) toast(message, true);
  }

  function disconnect(message = 'Disconnected.', silent = false) {
    const state = active;
    if (!state) { hidePairing(); renderStatus(); return; }
    state.closed = true;
    clearTimeout(state.timer);
    cancelTransfers(message, false);
    active = null;
    try { state.conn.close(); } catch (_) { /* Already closed. */ }
    hidePairing();
    renderStatus();
    if (message && !silent) toast(message, false);
  }

  function validPin(value) {
    const pin = String(value || '').trim();
    if (!PIN_PATTERN.test(pin)) return null;
    if (pin === currentPin) return null;
    return pin;
  }

  function initiateConnect(value) {
    if (active) {
      toast('Disconnect the current peer before switching connections.', true);
      return;
    }
    const pin = validPin(value);
    if (!pin) {
      toast('Enter a different six-digit numeric PIN.', true);
      ui.targetPeerId.focus();
      return;
    }
    if (!peer || !peer.open) {
      toast('The signaling node is still connecting. Please retry shortly.', true);
      return;
    }
    showPairing(pin);
    try { bindConnection(peer.connect(`aether-pin-${pin}`, { reliable: true })); }
    catch (_) {
      hidePairing();
      toast('Could not start pairing. Please retry.', true);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
  }

  function resetHud() {
    ui.transferProgressBar.style.width = '0%';
    ui.transferProgressBar.setAttribute('aria-valuenow', '0');
    ui.transferPercent.textContent = '0%';
    ui.transferSpeed.textContent = '—';
    ui.transferBytes.textContent = '0 B';
  }

  function showTransfer(title, name, total) {
    ui.transferModalTitle.textContent = title;
    ui.transferModalFileName.textContent = name;
    ui.mediaFileName.textContent = name;
    ui.transferProgressBar.setAttribute('aria-valuemax', String(Math.max(total, 1)));
    resetHud();
    openDialog(ui.transferOverlay);
  }

  function updateHud(bytes, total, startedAt) {
    const percent = total === 0 ? 0 : Math.min(100, Math.round(bytes / total * 100));
    ui.transferProgressBar.style.width = `${percent}%`;
    ui.transferProgressBar.setAttribute('aria-valuenow', String(bytes));
    ui.transferPercent.textContent = `${percent}%`;
    ui.transferBytes.textContent = `${formatBytes(bytes)} / ${formatBytes(total)}`;
    const elapsed = (Date.now() - startedAt) / 1000;
    ui.transferSpeed.textContent = elapsed > 0 && bytes > 0
      ? `${(bytes / 1024 / 1024 / elapsed).toFixed(2)} MB/s`
      : '—';
  }

  function ensureOpen(state) {
    if (!state || state.cancelled || active !== state.connection || !state.connection.open) {
      throw new Error('Transfer cancelled');
    }
  }

  function waitForBackpressure(state) {
    const channel = state.connection.conn.dataChannel;
    if (!channel || typeof channel.bufferedAmount !== 'number') return Promise.resolve();
    if (typeof channel.bufferedAmountLowThreshold === 'number') {
      channel.bufferedAmountLowThreshold = CHUNK_SIZE;
    }
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer;
      const done = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (channel.removeEventListener) channel.removeEventListener('bufferedamountlow', onLow);
        error ? reject(error) : resolve();
      };
      const onLow = () => {
        if (channel.bufferedAmount <= 4 * CHUNK_SIZE) done();
      };
      const poll = () => {
        try { ensureOpen(state); } catch (error) { done(error); return; }
        if (channel.bufferedAmount <= 4 * CHUNK_SIZE) { done(); return; }
        timer = setTimeout(poll, 25);
      };
      if (channel.addEventListener) channel.addEventListener('bufferedamountlow', onLow);
      poll();
    });
  }

  function readSlice(file, offset, state) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      state.reader = reader;
      reader.onload = event => { state.reader = null; resolve(event.target.result); };
      reader.onerror = () => { state.reader = null; reject(new Error('Could not read the selected file.')); };
      reader.onabort = () => { state.reader = null; reject(new Error('Transfer cancelled')); };
      try { reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE)); }
      catch (_) { state.reader = null; reject(new Error('Could not read the selected file.')); }
    });
  }

  async function transmitFile(file, connection) {
    const state = { connection, file, cancelled: false, reader: null, startedAt: Date.now() };
    sender = state;
    showTransfer('Transmitting file', file.name, file.size);
    try {
      ensureOpen(state);
      connection.conn.send({
        type: 'meta', name: file.name.slice(0, 255), size: file.size,
        mimeType: (file.type || 'application/octet-stream').slice(0, 128)
      });
      let offset = 0;
      if (file.size === 0) updateHud(0, 0, state.startedAt);
      while (offset < file.size) {
        ensureOpen(state);
        const payload = await readSlice(file, offset, state);
        ensureOpen(state);
        await waitForBackpressure(state);
        ensureOpen(state);
        connection.conn.send({ type: 'chunk', payload });
        offset += payload.byteLength;
        updateHud(offset, file.size, state.startedAt);
      }
      ensureOpen(state);
      connection.conn.send({ type: 'end' });
      if (file.size === 0) {
        ui.transferProgressBar.style.width = '100%';
        ui.transferProgressBar.setAttribute('aria-valuenow', '0');
        ui.transferPercent.textContent = '100%';
      }
      ui.transferModalTitle.textContent = 'Sent (delivery not confirmed)';
      toast(`${file.name} was sent to the data channel; delivery is not confirmed.`, false);
    } catch (error) {
      if (error.message !== 'Transfer cancelled') toast(error.message, true);
      throw error;
    } finally {
      if (sender === state) sender = null;
      state.reader = null;
      if (!active || active !== connection) closeDialog(ui.transferOverlay);
      else setTimeout(() => { if (!sender && !incoming) closeDialog(ui.transferOverlay); }, 800);
    }
  }

  function drainSendQueue() {
    if (sender || !active || !active.open || !sendQueue.length) return;
    const item = sendQueue.shift();
    transmitFile(item.file, active).then(item.resolve, item.reject).finally(drainSendQueue);
  }

  function enqueueFile(file) {
    if (!(file instanceof File) || !active || !active.open) {
      toast('Pair with a peer before choosing files.', true);
      return;
    }
    if (sendQueue.length >= MAX_FILES) {
      toast('The outgoing queue is full. Wait for current files to finish.', true);
      return;
    }
    sendQueue.push({ file, resolve: () => {}, reject: () => {} });
    drainSendQueue();
  }

  function processFiles(files) {
    Array.from(files || []).forEach(enqueueFile);
  }

  function toArrayBuffer(payload) {
    if (payload instanceof ArrayBuffer) return payload;
    if (ArrayBuffer.isView(payload)) return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    return null;
  }

  function validMeta(data) {
    return data && typeof data.name === 'string' && data.name.length > 0 && data.name.length <= 255 &&
      Number.isSafeInteger(data.size) && data.size >= 0 && data.size <= MAX_INBOUND_BYTES &&
      typeof data.mimeType === 'string' && data.mimeType.length <= 128;
  }

  function sendAbort(reason) {
    if (active && active.open) {
      try { active.conn.send({ type: 'abort', reason: String(reason).slice(0, 120) }); } catch (_) { /* Channel is closing. */ }
    }
  }

  function discardIncoming(message, notify = true) {
    if (!incoming) return;
    clearTimeout(incoming.timer);
    incoming = null;
    closeDialog(ui.transferOverlay);
    resetHud();
    if (notify) toast(message, true);
  }

  function armIncomingTimeout() {
    clearTimeout(incoming.timer);
    incoming.timer = setTimeout(() => {
      sendAbort('receive timeout');
      discardIncoming('The incoming transfer stalled and was discarded.', true);
    }, STALL_TIMEOUT);
  }

  function receiveMeta(data) {
    if (!validMeta(data)) { sendAbort('invalid metadata'); toast('Rejected an invalid incoming file description.', true); return; }
    if (incoming || sender) {
      sendAbort('busy');
      toast('A simultaneous transfer was rejected to keep the transfer HUD coherent.', true);
      return;
    }
    if (retainedBytes + data.size > MAX_INBOUND_BYTES) {
      sendAbort('memory limit');
      toast('The inbound memory limit is 512 MiB; file rejected.', true);
      return;
    }
    incoming = { meta: data, chunks: [], receivedBytes: 0, timer: null, startedAt: Date.now() };
    showTransfer('Receiving inbound file', data.name, data.size);
    armIncomingTimeout();
  }

  function receiveChunk(data) {
    if (!incoming) { sendAbort('missing metadata'); return; }
    const payload = toArrayBuffer(data && data.payload);
    if (!payload || payload.byteLength > CHUNK_SIZE ||
        incoming.receivedBytes + payload.byteLength > incoming.meta.size ||
        incoming.receivedBytes + payload.byteLength > MAX_INBOUND_BYTES) {
      sendAbort('invalid chunk');
      discardIncoming('The incoming transfer was invalid and discarded.', true);
      return;
    }
    incoming.chunks.push(payload);
    incoming.receivedBytes += payload.byteLength;
    updateHud(incoming.receivedBytes, incoming.meta.size, incoming.startedAt);
    armIncomingTimeout();
  }

  function appendInboundItem(meta, url, size) {
    const item = document.createElement('div');
    item.className = 'inbound-item';
    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('strong');
    name.className = 'file-name';
    name.textContent = meta.name;
    const details = document.createElement('span');
    details.className = 'file-meta';
    details.textContent = `${formatBytes(size)} · ${meta.mimeType || 'application/octet-stream'}`;
    info.append(name, details);
    const download = document.createElement('a');
    download.className = 'download-link';
    download.href = url;
    download.download = meta.name;
    download.textContent = 'Download';
    item.append(info, download);
    if (meta.mimeType.startsWith('video/')) {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'preview-button';
      preview.textContent = 'Preview';
      preview.addEventListener('click', () => {
        ui.videoPlaceholder.hidden = true;
        ui.liveVideoPlayer.hidden = false;
        ui.liveVideoPlayer.src = url;
        ui.liveVideoPlayer.load();
        ui.mediaFileName.textContent = meta.name;
      });
      item.append(preview);
    }
    ui.inboundFileList.prepend(item);
    ui.inboundEmpty.hidden = true;
    inboundCount++;
    ui.inboundCountBadge.textContent = `${inboundCount} file${inboundCount === 1 ? '' : 's'}`;
  }

  function finalizeIncoming() {
    if (!incoming) { toast('Rejected an end marker without file metadata.', true); return; }
    const state = incoming;
    clearTimeout(state.timer);
    incoming = null;
    if (state.receivedBytes !== state.meta.size) {
      sendAbort('incomplete file');
      closeDialog(ui.transferOverlay);
      resetHud();
      toast('The incoming file was incomplete and discarded.', true);
      return;
    }
    const blob = new Blob(state.chunks, { type: state.meta.mimeType || 'application/octet-stream' });
    if (blob.size !== state.meta.size) {
      sendAbort('size mismatch');
      closeDialog(ui.transferOverlay);
      resetHud();
      toast('The incoming file failed its size check and was discarded.', true);
      return;
    }
    retainedBytes += blob.size;
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    appendInboundItem(state.meta, url, blob.size);
    if (state.meta.mimeType.startsWith('video/')) {
      ui.videoPlaceholder.hidden = true;
      ui.liveVideoPlayer.hidden = false;
      ui.liveVideoPlayer.src = url;
      ui.liveVideoPlayer.load();
      ui.mediaFileName.textContent = state.meta.name;
    }
    ui.transferProgressBar.style.width = '100%';
    ui.transferProgressBar.setAttribute('aria-valuenow', String(state.meta.size));
    ui.transferPercent.textContent = '100%';
    ui.transferSpeed.textContent = state.meta.size ? ui.transferSpeed.textContent : '—';
    closeDialog(ui.transferOverlay);
    toast(`${state.meta.name} received.`, false);
  }

  function handleIncomingData(data) {
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type === 'meta') receiveMeta(data);
    else if (data.type === 'chunk') receiveChunk(data);
    else if (data.type === 'end') finalizeIncoming();
    else if (data.type === 'abort') discardIncoming('The peer cancelled the transfer.', true);
  }

  function cancelTransfers(message, notify = true) {
    if (sender) {
      sender.cancelled = true;
      if (sender.reader && sender.reader.readyState === FileReader.LOADING) {
        try { sender.reader.abort(); } catch (_) { /* Reader is finishing. */ }
      }
      sender = null;
    }
    sendQueue.splice(0).forEach(item => item.reject(new Error('Transfer cancelled')));
    if (incoming) discardIncoming(message || 'Transfer cancelled.', false);
    closeDialog(ui.transferOverlay);
    if (notify && message) toast(message, true);
  }

  // UI wiring and modal controls are deliberately event-based for static pages.
  function copyPin() {
    const value = ui.myPeerId.value;
    if (!PIN_PATTERN.test(value)) return;
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
      area.remove();
      return copied;
    };
    Promise.resolve().then(() => navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(value) : fallback())
      .then(() => { ui.copyIdBtn.textContent = 'Copied!'; setTimeout(() => { ui.copyIdBtn.textContent = 'Copy'; }, 2000); })
      .catch(() => { if (fallback()) toast('PIN copied.', false); else toast('Could not copy the PIN. Select it and copy manually.', true); });
  }

  function showQr() {
    if (!PIN_PATTERN.test(currentPin)) return;
    if (typeof window.QRious !== 'function') { toast('The QR generator is still loading. Please retry.', true); return; }
    new window.QRious({ element: ui.qrCanvas,
      value: `${window.location.origin}${window.location.pathname}?pair=${currentPin}`,
      size: 240, background: '#ffffff', foreground: '#080a0f' });
    ui.qrPinLabel.textContent = `PIN: ${currentPin}`;
    openDialog(ui.qrModal);
  }

  async function stopScanner() {
    const instance = scanner;
    scanner = null;
    scanIntent++;
    closeDialog(ui.scannerModal);
    if (!instance) return;
    try { await instance.stop(); } catch (_) { /* It may not have started. */ }
    try { instance.clear(); } catch (_) { /* Already cleared. */ }
  }

  async function startScanner() {
    if (typeof window.Html5Qrcode !== 'function') { toast('The QR scanner is still loading. Please retry.', true); return; }
    await stopScanner();
    if (active) return;
    const intent = ++scanIntent;
    let instance;
    try { instance = new window.Html5Qrcode('cameraPreview'); }
    catch (_) { toast('Could not open the camera scanner.', true); return; }
    scanner = instance;
    openDialog(ui.scannerModal);
    const stopIfStale = () => intent !== scanIntent || scanner !== instance;
    try {
      await instance.start({ facingMode: 'environment' }, { fps: 15, qrbox: { width: 250, height: 250 } }, decoded => {
        if (stopIfStale()) return;
        let pin = null;
        try { pin = new URL(decoded).searchParams.get('pair'); } catch (_) { pin = String(decoded).trim(); }
        if (!PIN_PATTERN.test(pin) || pin === currentPin) {
          toast('The scanned code does not contain a usable six-digit PIN.', true);
          return;
        }
        void stopScanner().then(() => { ui.targetPeerId.value = pin; initiateConnect(pin); });
      }, () => {});
      if (stopIfStale()) await stopScanner();
    } catch (_) {
      if (!stopIfStale()) toast('Camera permission was denied or the camera is unavailable.', true);
      await stopScanner();
    }
  }

  function clearInbound() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
    retainedBytes = 0;
    inboundCount = 0;
    ui.inboundFileList.replaceChildren();
    ui.inboundEmpty.hidden = false;
    ui.inboundCountBadge.textContent = '0 files';
    ui.liveVideoPlayer.pause();
    ui.liveVideoPlayer.removeAttribute('src');
    ui.liveVideoPlayer.load();
    ui.liveVideoPlayer.hidden = true;
    ui.videoPlaceholder.hidden = false;
    ui.mediaFileName.textContent = '';
  }

  function cancelPairing() {
    if (active && !active.open) disconnect('Pairing cancelled.', false);
    else hidePairing();
  }

  function cancelTransfer() {
    if (!sender && !incoming) { closeDialog(ui.transferOverlay); return; }
    sendAbort('cancelled');
    cancelTransfers('Transfer cancelled.', true);
  }

  function handleKeydown(event) {
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (dialog === ui.pairingOverlay) cancelPairing();
      else if (dialog === ui.transferOverlay) cancelTransfer();
      else if (dialog === ui.scannerModal) void stopScanner();
      else if (dialog === ui.qrModal) closeDialog(ui.qrModal);
      else if (dialog === ui.offlineScreen && navigator.onLine) closeDialog(ui.offlineScreen);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(dialog);
    if (!items.length) { event.preventDefault(); dialog.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function wireUi() {
    [ui.pairingOverlay, ui.transferOverlay, ui.qrModal, ui.scannerModal, ui.offlineScreen]
      .forEach(dialog => { if (dialog) dialog.hidden = true; });
    resetHud();
    ui.transferProgressBar.setAttribute('role', 'progressbar');
    ui.transferProgressBar.setAttribute('aria-valuemin', '0');
    ui.inboundEmpty.hidden = ui.inboundFileList.children.length > 0;
    ui.liveVideoPlayer.hidden = true;
    ui.videoPlaceholder.hidden = false;
    ui.statusPill.dataset.state = 'connecting';
    document.body.dataset.connected = 'false';
    ui.connectBtn.addEventListener('click', () => initiateConnect(ui.targetPeerId.value));
    ui.targetPeerId.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); initiateConnect(ui.targetPeerId.value); }
    });
    ui.copyIdBtn.addEventListener('click', copyPin);
    ui.showQrBtn.addEventListener('click', showQr);
    ui.closeQrBtn.addEventListener('click', () => closeDialog(ui.qrModal));
    ui.scanQrBtn.addEventListener('click', () => { void startScanner(); });
    ui.closeScannerBtn.addEventListener('click', () => { void stopScanner(); });
    ui.disconnectBtn.addEventListener('click', () => disconnect('Disconnected.', false));
    ui.cancelPairingBtn.addEventListener('click', cancelPairing);
    ui.cancelTransferBtn.addEventListener('click', cancelTransfer);
    ui.clearInboundBtn.addEventListener('click', clearInbound);
    ui.browseFilesBtn.addEventListener('click', () => ui.fileInput.click());
    ui.fileInput.addEventListener('change', event => {
      processFiles(event.target.files);
      event.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(type => ui.dropZone.addEventListener(type, event => {
      event.preventDefault(); event.stopPropagation(); ui.dropZone.classList.add('active');
    }));
    ['dragleave', 'drop'].forEach(type => ui.dropZone.addEventListener(type, event => {
      event.preventDefault(); event.stopPropagation(); ui.dropZone.classList.remove('active');
    }));
    ui.dropZone.addEventListener('drop', event => processFiles(event.dataTransfer && event.dataTransfer.files));
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('click', event => {
      if (event.target === ui.qrModal) closeDialog(ui.qrModal);
      if (event.target === ui.scannerModal) void stopScanner();
    });
    window.addEventListener('offline', () => {
      renderStatus();
      openDialog(ui.offlineScreen);
    });
    window.addEventListener('online', () => {
      closeDialog(ui.offlineScreen);
      if (!peer || peer.destroyed) initPeer();
      else renderStatus();
    });
    ui.retryOfflineBtn.addEventListener('click', () => {
      if (!navigator.onLine) { toast('The browser is still offline.', true); return; }
      closeDialog(ui.offlineScreen);
      if (!peer || peer.destroyed || !peer.open) initPeer();
      else renderStatus();
    });
    renderStatus();
  }

  function cleanup() {
    shuttingDown = true;
    void stopScanner();
    cancelTransfers('Page closed.', false);
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
    if (active) {
      try { active.conn.close(); } catch (_) { /* Page is closing. */ }
    }
    destroyPeer();
  }

  wireUi();
  window.addEventListener('beforeunload', cleanup);
  initPeer();
})();

(() => {
  'use strict';

  const liveVideoPlayer = document.getElementById('liveVideoPlayer');
  const stage = document.getElementById('videoViewport');
  const bay = document.getElementById('videoViewportBay') || (stage && stage.parentElement);
  const formatLabel = document.getElementById('videoFormatLabel');
  const DEFAULT_RATIO = 16 / 9;

  if (!liveVideoPlayer || !stage || !bay) return;

  let ratio = DEFAULT_RATIO;
  let videoReady = false;
  let frame = null;
  let observer = null;
  let observedWidth = null;
  let tornDown = false;

  function validDimension(value) {
    return Number.isFinite(value) && value > 0;
  }

  function ratioLabel(width, height, value) {
    let a = Math.round(width);
    let b = Math.round(height);
    while (b) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    if (a > 0) return `${Math.round(width / a)}:${Math.round(height / a)}`;
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function setPresentation(nextRatio, ready) {
    ratio = validDimension(nextRatio) ? nextRatio : DEFAULT_RATIO;
    videoReady = Boolean(ready);
    stage.dataset.orientation = ratio < 1 ? 'portrait' : ratio > 1 ? 'landscape' : 'square';
    stage.dataset.videoReady = String(videoReady);
    if (formatLabel) {
      if (videoReady && validDimension(liveVideoPlayer.videoWidth) && validDimension(liveVideoPlayer.videoHeight)) {
        formatLabel.textContent = `${liveVideoPlayer.videoWidth} × ${liveVideoPlayer.videoHeight} · ${ratioLabel(liveVideoPlayer.videoWidth, liveVideoPlayer.videoHeight, ratio)}`;
      } else {
        formatLabel.textContent = 'AUTO FIT';
      }
    }
  }

  function fitVideoViewport() {
    const viewportWidth = Number(window.innerWidth);
    const viewportHeight = Number(window.innerHeight);
    const styles = window.getComputedStyle(bay);
    const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
    const availableBayWidth = bay.clientWidth - paddingLeft - paddingRight;
    if (!validDimension(viewportWidth) || !validDimension(viewportHeight) ||
        !validDimension(availableBayWidth) || !validDimension(ratio)) return false;

    const width = Math.min(
      viewportWidth * 0.85,
      760,
      availableBayWidth,
      480 * ratio,
      viewportHeight * 0.65 * ratio
    );
    const height = width / ratio;
    if (!validDimension(width) || !validDimension(height)) return false;

    stage.style.maxWidth = `${width}px`;
    stage.style.height = `${height}px`;
    stage.style.aspectRatio = `${ratio}`;
    return true;
  }

  function scheduleFit() {
    if (tornDown || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      fitVideoViewport();
    });
  }

  function resetMetadata() {
    setPresentation(DEFAULT_RATIO, false);
    scheduleFit();
  }

  function updateMetadata() {
    const width = Number(liveVideoPlayer.videoWidth);
    const height = Number(liveVideoPlayer.videoHeight);
    if (!validDimension(width) || !validDimension(height)) {
      resetMetadata();
      return;
    }
    setPresentation(width / height, true);
    scheduleFit();
  }

  function handleBayResize(entries) {
    for (const entry of entries) {
      const width = Number(entry.contentRect && entry.contentRect.width);
      if (!validDimension(width)) continue;
      if (observedWidth === null || Math.abs(width - observedWidth) > 0.01) {
        observedWidth = width;
        scheduleFit();
      }
    }
  }

  const resizeEvents = [];
  const listen = (target, type, handler) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    resizeEvents.push(() => target.removeEventListener(type, handler));
  };

  const onViewportResize = () => scheduleFit();
  const onPageHide = event => {
    if (event.persisted) {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      return;
    }
    teardown();
  };
  const onPageShow = event => {
    if (event.persisted) scheduleFit();
  };

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    resizeEvents.splice(0).forEach(remove => remove());
  }

  setPresentation(DEFAULT_RATIO, false);
  fitVideoViewport();

  listen(liveVideoPlayer, 'loadedmetadata', updateMetadata);
  listen(liveVideoPlayer, 'resize', updateMetadata);
  listen(liveVideoPlayer, 'emptied', resetMetadata);
  listen(liveVideoPlayer, 'loadstart', resetMetadata);
  listen(liveVideoPlayer, 'error', resetMetadata);
  listen(window, 'resize', onViewportResize);
  listen(window, 'orientationchange', onViewportResize);
  if (window.visualViewport) listen(window.visualViewport, 'resize', onViewportResize);
  listen(window, 'pagehide', onPageHide);
  listen(window, 'pageshow', onPageShow);
  listen(window, 'beforeunload', teardown);

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(handleBayResize);
    observer.observe(bay);
  }
})();

(() => {
  'use strict';

  const STORAGE_KEY = 'freqbeacon:radio-context:v1';

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function write(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('freqbeacon:radio-context', { detail: next }));
    } catch {}
    return next;
  }

  function update(patch = {}) {
    const current = read();
    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now()
    };
    return write(next);
  }

  function clearReceiver() {
    const current = read();
    delete current.receiver;
    return write({ ...current, updatedAt: Date.now() });
  }

  window.FREQBEACON_RADIO_CONTEXT = Object.freeze({
    STORAGE_KEY,
    read,
    update,
    clearReceiver
  });
})();
export function createTextureQueue({ load, limit = 8, canRun = () => true }) {
  const cache = new Map();
  const queue = [];
  let running = 0;
  const max = () => (typeof limit === 'function' ? limit() : limit);

  function pump() {
    while (running < max() && queue.length && canRun()) {
      const job = queue.shift();
      running++;
      Promise.resolve().then(() => load(job.key)).then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  }

  function request(key) {
    if (!cache.has(key)) {
      const pending = new Promise((resolve, reject) => queue.push({ key, resolve, reject }));
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
      pump();
    }
    return cache.get(key);
  }

  const clear = () => { queue.length = 0; cache.clear(); };

  return { request, pump, clear, stats: () => ({ sources: cache.size, loading: running, queued: queue.length }) };
}

export function createTextureRegistry() {
  const entries = new Map();
  let waiters = [];
  const pendingCount = () => { let n = 0; for (const e of entries.values()) if (e.state === 'pending') n++; return n; };
  const wake = () => {
    if (pendingCount()) return;
    const list = waiters;
    waiters = [];
    for (const resolve of list) resolve();
  };
  return {
    begin(key) {
      const entry = entries.get(key);
      if (!entry) entries.set(key, { state: 'pending', error: null, attempts: 1 });
      else if (entry.state === 'failed') { entry.state = 'pending'; entry.error = null; entry.attempts++; }
    },
    ready(key) {
      const entry = entries.get(key);
      if (entry) { entry.state = 'ready'; entry.error = null; }
      wake();
    },
    fail(key, error) {
      const entry = entries.get(key) ?? { attempts: 1 };
      entry.state = 'failed';
      entry.error = String(error?.message ?? error);
      entries.set(key, entry);
      wake();
    },
    clear() { entries.clear(); const list = waiters; waiters = []; for (const resolve of list) resolve(); },
    settled() { return pendingCount() ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve(); },
    failedKeys() { return [...entries].filter(([, e]) => e.state === 'failed').map(([key]) => key); },
    report() {
      let ready = 0, pending = 0, failed = 0;
      const failedList = [];
      for (const [url, e] of entries) {
        if (e.state === 'ready') ready++;
        else if (e.state === 'failed') { failed++; failedList.push({ url, error: e.error, attempts: e.attempts }); }
        else pending++;
      }
      return { total: entries.size, ready, pending, failed, failedList, allReady: entries.size > 0 && pending === 0 && failed === 0 };
    },
  };
}

const PNG_END = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

export function looksComplete(bytes, url = '') {
  const n = bytes?.byteLength ?? 0;
  if (n < 12) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    for (let i = 0; i < PNG_END.length; i++) if (bytes[n - PNG_END.length + i] !== PNG_END[i]) return false;
    return true;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = n - 1; i > Math.max(1, n - 16); i--) if (bytes[i - 1] === 0xff && bytes[i] === 0xd9) return true;
    return false;
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    const size = (bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24) >>> 0;
    return size + 8 <= n;
  }
  return !/\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(url);
}

export function placeholderColor(url) {
  return /_n\.(?:png|webp|jpe?g)(?:[?#].*)?$/i.test(url) ? [128, 128, 255, 255] : [200, 200, 200, 255];
}

export function canUseImageBitmap(userAgent = globalThis.navigator?.userAgent ?? '', hasBitmap = typeof globalThis.createImageBitmap === 'function') {
  if (!hasBitmap) return false;
  const safari = /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(userAgent);
  return !safari && !/Firefox\//.test(userAgent);
}

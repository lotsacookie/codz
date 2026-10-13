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

  return { request, pump, stats: () => ({ sources: cache.size, loading: running, queued: queue.length }) };
}

export function placeholderColor(url) {
  return /_n\.(?:png|webp|jpe?g)(?:[?#].*)?$/i.test(url) ? [128, 128, 255, 255] : [200, 200, 200, 255];
}

export function canUseImageBitmap(userAgent = globalThis.navigator?.userAgent ?? '', hasBitmap = typeof globalThis.createImageBitmap === 'function') {
  if (!hasBitmap) return false;
  const safari = /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(userAgent);
  return !safari && !/Firefox\//.test(userAgent);
}

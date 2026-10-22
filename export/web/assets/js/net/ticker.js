// Timers that keep running while the tab is hidden. Browsers stop animation frames in a hidden tab and slow
// ordinary timers to about one tick a second (or less after a few minutes), which froze the host's zombies and made
// players vanish for everyone else. A Worker's timer is not throttled the same way, so it drives the background
// updates. Falls back to plain timers when Workers or Blob URLs are unavailable (tests, strict CSP).
const WORKER_SOURCE = `let id = 0, timers = new Map();
onmessage = e => {
  const { type, key, ms } = e.data;
  if (type === 'start') timers.set(key, setInterval(() => postMessage(key), ms));
  else if (type === 'stop') { clearInterval(timers.get(key)); timers.delete(key); }
};`;

export function createTickTimers({ Worker = globalThis.Worker, Blob = globalThis.Blob, URL = globalThis.URL, plain = {
  setInterval: (...args) => globalThis.setInterval(...args), clearInterval: (...args) => globalThis.clearInterval(...args),
} } = {}) {
  let worker = null, failed = false, nextKey = 1;
  const callbacks = new Map();
  function ensure() {
    if (worker || failed) return worker;
    try {
      if (typeof Worker !== 'function' || typeof Blob !== 'function' || !URL?.createObjectURL) throw new Error('no worker');
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      worker = new Worker(url);
      URL.revokeObjectURL?.(url);
      worker.onmessage = e => { try { callbacks.get(e.data)?.(); } catch {} };
      worker.onerror = () => { failed = true; try { worker.terminate(); } catch {} worker = null; };
    } catch { failed = true; worker = null; }
    return worker;
  }
  return {
    setInterval(fn, ms) {
      const w = ensure();
      if (!w) return plain.setInterval(fn, ms);
      const key = nextKey++;
      callbacks.set(key, fn);
      w.postMessage({ type: 'start', key, ms });
      return key;
    },
    clearInterval(key) {
      if (callbacks.has(key)) {
        callbacks.delete(key);
        try { worker?.postMessage({ type: 'stop', key }); } catch {}
        if (!callbacks.size) { try { worker?.terminate(); } catch {} worker = null; }
      } else plain.clearInterval(key);
    },
  };
}

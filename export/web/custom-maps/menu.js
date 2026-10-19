import { PROVIDERS, providerById, isModelUrl } from './providers.js';
import { isGithubRepoUrl } from './iwmap-remote.js';

const TOKEN_KEY = 'zombies.sketchfabToken';
const SOURCE_KEY = 'zombies.customSource';

const store = {
  get(key) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export function createCustomMenu({ root, onPlay, onClose }) {
  const state = { provider: providerById(store.get(SOURCE_KEY)), cursors: [null], page: 0, items: [], run: 0, loaded: false };

  const source = el('select', { class: 'cm-source', 'aria-label': 'Model source' });
  for (const provider of PROVIDERS) source.append(el('option', { value: provider.id, text: provider.label }));
  source.value = state.provider.id;
  const query = el('input', { class: 'cm-query', type: 'search', placeholder: 'Search maps, or paste a .glb / .gltf / .bsp / .map link', 'aria-label': 'Search' });
  const token = el('input', { class: 'cm-token', type: 'password', placeholder: 'Sketchfab API token', autocomplete: 'off', 'aria-label': 'Sketchfab API token' });
  token.value = store.get(TOKEN_KEY);
  const search = el('button', { type: 'submit', text: 'SEARCH' });
  const file = el('button', { type: 'button', class: 'cm-file', text: 'OPEN FILE…' });
  const picker = el('input', { type: 'file', accept: '.glb,.gltf,.zip,.bsp,.map', hidden: '' });
  const form = el('form', { class: 'cm-bar' }, source, query, token, search, file);
  const status = el('p', { class: 'cm-status', role: 'status' });
  const grid = el('ul', { class: 'cm-grid' });
  const prev = el('button', { type: 'button', text: '◀ PREV' });
  const next = el('button', { type: 'button', text: 'NEXT ▶' });
  const back = el('button', { type: 'button', class: 'cm-back', text: 'BACK' });
  const pageLabel = el('span', { class: 'cm-page' });
  const pager = el('div', { class: 'cm-pager' }, prev, pageLabel, next, back);
  const panel = el('div', { class: 'cm-panel' }, el('p', { class: 'cm-eyebrow', text: 'ZOMBIES / CUSTOM MAPS' }), el('h2', { text: 'CUSTOM MAPS' }), form, status, grid, pager, picker);
  root.replaceChildren(panel);

  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  function sync() {
    const needsToken = state.provider.needsToken;
    token.hidden = !needsToken;
    prev.disabled = state.page === 0;
    next.disabled = !state.cursors[state.page + 1];
    pageLabel.textContent = `PAGE ${state.page + 1}`;
  }

  function render() {
    grid.replaceChildren(...state.items.map((item, index) => {
      const thumb = item.thumb ? el('img', { src: item.thumb, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : el('i');
      const meta = [item.author, item.license, item.detail].filter(Boolean).join(' · ');
      const text = el('div', { class: 'cm-text' }, el('strong', { text: item.name }), el('span', { text: meta }));
      const button = el('button', { type: 'button', class: 'cm-card', 'data-index': String(index) }, thumb, text);
      return el('li', {}, button);
    }));
    sync();
  }

  async function go(page) {
    const run = ++state.run;
    setStatus('Loading maps…');
    form.classList.add('busy');
    try {
      const result = await state.provider.search({ query: query.value, cursor: state.cursors[page] });
      if (run !== state.run) return;
      state.page = page;
      state.items = result.items;
      state.cursors.length = page + 1;
      if (result.next) state.cursors[page + 1] = result.next;
      state.loaded = true;
      render();
      setStatus(result.items.length ? (state.provider.hint ?? 'Pick a map to play. Perks, box and windows are placed automatically.') : 'Nothing found. Try another search.');
    } catch (error) {
      if (run !== state.run) return;
      state.items = [];
      render();
      setStatus(error?.message ?? String(error), true);
    } finally {
      if (run === state.run) form.classList.remove('busy');
    }
  }

  function reset() {
    state.cursors = [null];
    state.page = 0;
    return go(0);
  }

  async function play(item) {
    const secret = token.value.trim();
    if (state.provider.needsToken && !secret) {
      setStatus('Paste your Sketchfab API token above to download models (sketchfab.com → Settings → Password & API).', true);
      token.focus();
      return;
    }
    store.set(TOKEN_KEY, secret);
    let params;
    try {
      setStatus(`Preparing ${item.name}…`);
      params = await state.provider.play(item, secret);
    } catch (error) {
      setStatus(error?.message ?? String(error), true);
      return;
    }
    if (params?.external) {
      el('a', { href: params.external, target: '_blank', rel: 'noopener noreferrer' }).click();
      setStatus(item.id === 'steam-search' ? 'Opened the Steam Workshop search. Workshop downloads are compiled for Black Ops 3, so this game can only load maps whose source repo is linked.' : `Opened ${item.name} on the Steam Workshop. It has no linked source repo, so it cannot be loaded here; subscribe in Black Ops 3 to play it there.`);
      return;
    }
    onPlay({ label: item.name, art: item.art || item.thumb, params: { ...params, name: item.name } });
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = query.value.trim();
    if (isModelUrl(text)) {
      const kind = /\.bsp(?:\?|$)/i.test(text) ? 'bsp' : /\.map(?:\?|$)/i.test(text) || isGithubRepoUrl(text) ? 'iwmap' : 'url';
      onPlay({ label: decodeURIComponent(text.split('?')[0].split('/').pop().replace(/\.(glb|gltf|bsp|map)$/i, '')) || 'Custom Map', params: { source: kind, url: text } });
      return;
    }
    store.set(TOKEN_KEY, token.value.trim());
    reset();
  });
  source.addEventListener('change', () => {
    state.provider = providerById(source.value);
    store.set(SOURCE_KEY, state.provider.id);
    reset();
  });
  file.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const chosen = picker.files?.[0];
    picker.value = '';
    if (chosen) onPlay({ label: chosen.name.replace(/\.(glb|gltf|zip|bsp)$/i, ''), params: { source: 'file', file: chosen } });
  });
  grid.addEventListener('click', event => {
    const button = event.target.closest('button[data-index]');
    if (button) play(state.items[Number(button.dataset.index)]);
  });
  prev.addEventListener('click', () => go(state.page - 1));
  next.addEventListener('click', () => go(state.page + 1));
  back.addEventListener('click', () => close());
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const step = event.target.tagName === 'BUTTON' ? { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key] : 0;
    if (!step) return;
    const list = items();
    const at = list.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    list[(at + step + list.length) % list.length].focus();
  });

  function items() {
    return [...root.querySelectorAll('button')].filter(node => !node.disabled && node.getClientRects().length > 0);
  }

  function isOpen() { return !root.hidden; }

  function open(sourceId) {
    root.hidden = false;
    if (typeof sourceId === 'string' && sourceId !== state.provider.id) {
      state.provider = providerById(sourceId);
      source.value = state.provider.id;
      state.loaded = false;
    }
    sync();
    if (!state.loaded) reset();
    (grid.querySelector('button') ?? query).focus({ preventScroll: true });
  }

  function close() {
    root.hidden = true;
    onClose?.();
  }

  return { open, close, isOpen, items };
}

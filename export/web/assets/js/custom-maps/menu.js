import { PROVIDERS, providerById, isModelUrl } from './providers.js';
import { isGithubRepoUrl } from './iwmap-remote.js';

const TOKEN_KEY = 'zombies.sketchfabToken';
const SOURCE_KEY = 'zombies.customSource';
const SHORT_LABELS = { bsp: 'NZ:P Maps', workshop: 'BO3 Workshop', polyhaven: 'Poly Haven', khronos: 'glTF Samples', sketchfab: 'Sketchfab', mods: 'Mods' };

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

  const tabs = el('div', { class: 'cm-tabs', role: 'group', 'aria-label': 'Map source' });
  for (const provider of PROVIDERS) tabs.append(el('button', { type: 'button', class: 'cm-tab', 'data-source': provider.id, text: SHORT_LABELS[provider.id] ?? provider.label }));
  const query = el('input', { class: 'cm-query', type: 'search', placeholder: 'Search maps, or paste a .glb / .gltf / .bsp / .map link', 'aria-label': 'Search' });
  const token = el('input', { class: 'cm-token', type: 'password', placeholder: 'Sketchfab API token', autocomplete: 'off', 'aria-label': 'Sketchfab API token' });
  token.value = store.get(TOKEN_KEY);
  const search = el('button', { type: 'submit', text: 'SEARCH' });
  const file = el('button', { type: 'button', class: 'cm-file', text: 'OPEN FILE…' });
  const picker = el('input', { type: 'file', accept: '.glb,.gltf,.zip,.bsp,.map', hidden: '' });
  const form = el('form', { class: 'cm-bar' }, query, token, search, file);
  const status = el('p', { class: 'cm-status', role: 'status' });
  const grid = el('ul', { class: 'cm-list' });
  const prev = el('button', { type: 'button', text: '◀ PREV' });
  const next = el('button', { type: 'button', text: 'NEXT ▶' });
  const back = el('button', { type: 'button', class: 'cm-back', text: 'BACK' });
  const pageLabel = el('span', { class: 'cm-page' });
  const pager = el('div', { class: 'cm-pager' }, prev, pageLabel, next, back);
  const detailImage = el('img', { alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
  const detailTitle = el('h3', { class: 'detail-title' });
  const detailDesc = el('p', { class: 'detail-desc' });
  const detailInfo = el('p', { class: 'detail-info' });
  const detail = el('aside', { class: 'cm-detail', 'aria-live': 'polite' }, el('div', { class: 'detail-art' }, detailImage), detailTitle, detailDesc, detailInfo);
  const menu = el('div', { class: 'cm-menu' }, el('p', { class: 'cm-eyebrow', text: 'ZOMBIES / WORKSHOP' }), el('h2', { text: 'WORKSHOP' }), tabs, form, status, grid, pager);
  const panel = el('div', { class: 'cm-panel' }, menu, detail, picker);
  root.replaceChildren(panel);

  function showDetail(item) {
    const art = item?.art || item?.thumb || '';
    detail.classList.toggle('empty', !item);
    detailImage.hidden = !art;
    if (art && detailImage.getAttribute('src') !== art) detailImage.src = art;
    if (!art) detailImage.removeAttribute('src');
    detailTitle.textContent = item?.name ?? '';
    detailDesc.textContent = item ? (item.description || 'No description provided.') : 'Hover a map to see its details.';
    detailInfo.textContent = item ? [item.author && `By ${item.author}`, item.license, item.detail].filter(Boolean).join(' · ') : '';
  }
  showDetail(null);

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
    for (const tab of tabs.children) tab.classList.toggle('active', tab.dataset.source === state.provider.id);
  }

  function render() {
    grid.replaceChildren(...state.items.map((item, index) => {
      const button = el('button', { type: 'button', class: 'cm-item', 'data-index': String(index) }, el('strong', { text: item.name }));
      return el('li', {}, button);
    }));
    showDetail(null);
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

  async function modAction(item, name) {
    try {
      setStatus('Working…');
      const message = await state.provider[name](item);
      state.items = (await state.provider.search({})).items;
      render();
      setStatus(message);
    } catch (error) {
      setStatus(error?.message ?? String(error), true);
    }
  }

  async function play(item) {
    if (state.provider.activate) return modAction(item, 'activate');
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
      setStatus(`Opened ${item.name} on the Steam Workshop. It has no linked source repo, so it cannot be loaded here.`);
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
  tabs.addEventListener('click', event => {
    const tab = event.target.closest('button[data-source]');
    if (!tab || tab.dataset.source === state.provider.id) return;
    state.provider = providerById(tab.dataset.source);
    store.set(SOURCE_KEY, state.provider.id);
    reset();
  });
  const preview = event => {
    const button = event.target.closest?.('button[data-index]');
    if (button) showDetail(state.items[Number(button.dataset.index)]);
  };
  grid.addEventListener('mouseover', preview);
  grid.addEventListener('focusin', preview);
  grid.addEventListener('mouseleave', () => {
    const focused = document.activeElement?.closest?.('button[data-index]');
    showDetail(focused && grid.contains(focused) ? state.items[Number(focused.dataset.index)] : null);
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
  grid.addEventListener('contextmenu', event => {
    const button = event.target.closest('button[data-index]');
    if (button && state.provider.remove) { event.preventDefault(); modAction(state.items[Number(button.dataset.index)], 'remove'); }
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
      state.loaded = false;
    }
    sync();
    if (!state.loaded) reset();
    (grid.querySelector('button') ?? query).focus({ preventScroll: true });
    document.body.classList.add('custom-open');
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove('custom-open');
    onClose?.();
  }

  return { open, close, isOpen, items };
}

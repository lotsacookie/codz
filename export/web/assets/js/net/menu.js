import { HostLobby, ClientLobby, ServerBrowser, newLobbyName } from './lobby.js';
import { loadJoinRoom } from './transport.js';
import { listBuiltinBsp } from '../custom-maps/providers.js';
import { MAX_PLAYERS, CUSTOM_MAP_ID, cleanName, normalizeCode, cleanCustomMap } from './protocol.js';

const NAME_KEY = 'zombies.playerName';
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
const customMapLabel = url => { try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.(?:glb|gltf|bsp|map)$/i, '') || 'Custom map'; } catch { return 'Custom map'; } };
const button = (text, onClick, cls = '') => { const b = el('button', { type: 'button', class: cls, text }); b.addEventListener('click', onClick); return b; };

/**
 * Multiplayer menu: Host a game, browse public games, or join by code, then wait in a lobby until the host starts.
 * `maps` is the list of co-op capable maps ({ id, label }); `onStart` boots the chosen map with the lobby attached.
 */
export function createMultiplayerMenu({ root, maps, onStart, onClose }) {
  let net = null, host = null, client = null, browser = null, view = 'home', closing = false;

  const title = el('h2', { text: 'MULTIPLAYER' });
  const status = el('p', { class: 'mp-status', role: 'status' });
  const body = el('div', { class: 'mp-body' });
  const nameInput = el('input', { class: 'mp-name', type: 'text', maxlength: '20', placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'nickname' });
  nameInput.value = store.get(NAME_KEY);
  nameInput.addEventListener('change', () => store.set(NAME_KEY, cleanName(nameInput.value)));
  const back = button('BACK', () => goBack(), 'mp-back');
  const menu = el('div', { class: 'mp-menu' }, el('p', { class: 'mp-eyebrow', text: 'ZOMBIES / MULTIPLAYER' }), title, nameInput, status, body, back);
  root.replaceChildren(el('div', { class: 'mp-panel' }, menu));

  const playerName = () => { const name = cleanName(nameInput.value || `Survivor${Math.floor(Math.random() * 900 + 100)}`); nameInput.value = name; store.set(NAME_KEY, name); return name; };
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  async function ensureNet() {
    if (net) return net;
    say('Connecting to the matchmaking network…');
    try { net = await loadJoinRoom(); } catch (error) { console.error(error); say('Multiplayer could not load. Check your connection and try again.', true); throw error; }
    return net;
  }

  async function teardown() {
    const old = [host, client, browser]; host = client = browser = null;
    await Promise.all(old.map(item => item?.close?.().catch?.(() => {})));
  }

  function show(next) { view = next; back.textContent = next === 'home' ? 'BACK' : next === 'lobby' ? 'LEAVE' : 'BACK'; }
  async function goBack() {
    if (view === 'home') { close(); return; }
    await teardown();
    say('');
    home();
  }

  function home() {
    show('home'); title.textContent = 'MULTIPLAYER';
    body.replaceChildren(
      button('HOST A GAME', hostForm, 'mp-big'),
      button('SERVER BROWSER', openBrowser, 'mp-big'),
      button('JOIN WITH CODE', joinForm, 'mp-big'),
      el('p', { class: 'mp-note', text: `Up to ${MAX_PLAYERS} players. Games connect directly between browsers on the same network, with no account needed.` }),
    );
  }

  function hostForm() {
    show('host'); title.textContent = 'HOST A GAME'; say('');
    const label = el('input', { type: 'text', maxlength: '32', 'aria-label': 'Game name', placeholder: 'Game name' });
    label.value = newLobbyName(playerName());
    const select = el('select', { 'aria-label': 'Map' }, ...maps.map(m => el('option', { value: m.id, text: m.label })), el('option', { value: CUSTOM_MAP_ID, text: 'Custom map…' }));
    const LINK = '__link__';
    const builtin = el('select', { 'aria-label': 'Custom map', hidden: '' }, el('option', { value: '', text: 'Loading maps…' }));
    const mapUrl = el('input', { type: 'url', maxlength: '500', placeholder: 'Link to a .glb / .gltf / .bsp / .map or GitHub map repo', 'aria-label': 'Custom map link', autocomplete: 'off', hidden: '' });
    let builtinMaps = null;
    const syncCustom = () => { mapUrl.hidden = select.value !== CUSTOM_MAP_ID || builtin.value !== LINK; };
    const loadBuiltin = async () => {
      if (builtinMaps) return;
      try {
        builtinMaps = await listBuiltinBsp();
        builtin.replaceChildren(...builtinMaps.map(m => el('option', { value: m.id, text: m.title })), el('option', { value: LINK, text: 'Paste a link instead…' }));
      } catch (error) {
        console.error(error);
        builtinMaps = [];
        builtin.replaceChildren(el('option', { value: LINK, text: 'Paste a link…' }));
      }
      syncCustom();
    };
    select.addEventListener('change', () => { const custom = select.value === CUSTOM_MAP_ID; builtin.hidden = !custom; syncCustom(); if (custom) loadBuiltin(); });
    builtin.addEventListener('change', syncCustom);
    const password = el('input', { type: 'text', maxlength: '32', placeholder: 'Password (optional, makes the game private)', 'aria-label': 'Password', autocomplete: 'off' });
    const create = button('CREATE GAME', async () => {
      let customMap = null;
      if (select.value === CUSTOM_MAP_ID) {
        const chosen = builtinMaps?.find(m => m.id === builtin.value);
        customMap = chosen
          ? cleanCustomMap({ builtin: chosen.id, label: chosen.title })
          : cleanCustomMap({ url: mapUrl.value, label: customMapLabel(mapUrl.value) });
        if (!customMap) { say(builtinMaps ? 'Pick a map from the list, or paste a direct http(s) link to a .glb, .gltf, .bsp or .map file or a GitHub map repository.' : 'The map list is still loading.', true); return; }
      }
      create.disabled = true;
      try {
        const network = await ensureNet();
        const map = customMap ? { id: CUSTOM_MAP_ID, label: customMap.label } : maps.find(m => m.id === select.value);
        host = new HostLobby(network, { name: label.value, playerName: playerName(), map: map.id, mapLabel: map.label, customMap, password: password.value.trim() }).open();
        lobbyView({ code: host.code, map: map.label, isHost: true, locked: !!password.value.trim() });
      } catch (error) {
        console.error(error);
        if (net) { await teardown(); say(`Could not start the game: ${error?.message ?? 'unknown error'}`, true); }
        create.disabled = false;
      }
    }, 'mp-big');
    body.replaceChildren(label, select, builtin, mapUrl, password, create);
  }

  function joinForm() {
    show('join'); title.textContent = 'JOIN WITH CODE'; say('');
    const code = el('input', { class: 'mp-code', type: 'text', maxlength: '8', placeholder: 'CODE', 'aria-label': 'Game code', autocomplete: 'off', autocapitalize: 'characters' });
    const password = el('input', { type: 'text', maxlength: '32', placeholder: 'Password (if the game has one)', 'aria-label': 'Password', autocomplete: 'off' });
    const go = button('JOIN', () => joinGame(normalizeCode(code.value), password.value.trim(), go), 'mp-big');
    body.replaceChildren(code, password, go);
    code.focus();
  }

  async function joinGame(code, password, trigger) {
    if (code.length < 4) { say('Enter the game code from the host.', true); return; }
    if (trigger) trigger.disabled = true;
    try {
      const network = await ensureNet();
      say('Looking for the game…');
      client = new ClientLobby(network, { code, playerName: playerName(), password });
      client.onStart = payload => launch(payload, 'client');
      client.onHostLeft = () => { if (view === 'lobby') { say('The host left the game.', true); teardown().then(home); } };
      const welcome = await client.connect();
      lobbyView({ code, map: welcome.mapLabel, isHost: false, name: welcome.name });
    } catch (error) {
      const message = error?.message ?? 'Could not join';
      await teardown();
      if (trigger?.isConnected) trigger.disabled = false;
      say(message, true);
    }
  }

  async function openBrowser() {
    show('browser'); title.textContent = 'SERVER BROWSER'; say('');
    const list = el('ul', { class: 'mp-list' });
    const empty = el('p', { class: 'mp-note', text: 'Looking for games…' });
    body.replaceChildren(list, empty);
    try {
      const network = await ensureNet();
      browser = new ServerBrowser(network).open({ onJoinError: () => say('Found a game but could not connect. Multiplayer only works between devices on the same network.', true) });
    } catch { return; }
    say('');
    const render = () => {
      const games = browser?.list() ?? [];
      empty.hidden = games.length > 0;
      empty.textContent = 'No public games right now. Games on your network show up here within a few seconds. Host one and share the code, or check again in a moment.';
      list.replaceChildren(...games.map(game => {
        const full = game.players >= game.max || game.started;
        const join = button(game.started ? 'IN PROGRESS' : full ? 'FULL' : 'JOIN', async () => {
          let password = '';
          if (game.locked) { password = prompt(`Password for ${game.name}`) ?? null; if (password === null) return; }
          const code = game.code;
          await teardown();   // leave the browser, then join
          await joinGame(code, password.trim());
        });
        join.disabled = full;
        return el('li', { class: 'mp-game' },
          el('div', { class: 'mp-game-info' }, el('strong', { text: game.name + (game.locked ? ' 🔒' : '') }), el('span', { text: `${game.mapLabel} · ${game.host}${game.round ? ` · round ${game.round}` : ''}` })),
          el('span', { class: 'mp-count', text: `${game.players}/${game.max}` }), join);
      }));
    };
    browser.onChange(render);
    render();
  }

  function lobbyView({ code, map, isHost, locked = false, name = '' }) {
    show('lobby'); title.textContent = isHost ? 'YOUR GAME' : (name || 'LOBBY'); say('');
    const players = el('ul', { class: 'mp-roster' });
    const info = el('p', { class: 'mp-note', text: `${map} · Code ${code}${locked ? ' · password protected' : ''}` });
    const lobby = host ?? client;
    const renderRoster = roster => {
      const list = roster ?? lobby?.players?.() ?? lobby?.roster ?? [];
      players.replaceChildren(...list.map(p => el('li', { class: p.ready ? 'ready' : '' }, el('strong', { text: p.name + (p.id === net?.selfId ? ' (you)' : '') }), el('span', { text: p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY' }))));
      if (start) start.disabled = list.length < 1;
    };
    let start = null;
    const actions = [];
    if (isHost) {
      start = button('START GAME', () => { const payload = host.start(); if (payload) launch(payload, 'host'); }, 'mp-big');
      actions.push(button('COPY CODE', async () => { try { await navigator.clipboard.writeText(code); say('Code copied.'); } catch { say(`Code: ${code}`); } }));
      actions.push(start);
    } else {
      const ready = button('READY', () => { const on = !ready.classList.contains('on'); ready.classList.toggle('on', on); ready.textContent = on ? 'READY ✓' : 'READY'; client.setReady(on); }, 'mp-big');
      actions.push(ready);
      say('Waiting for the host to start…');
    }
    body.replaceChildren(info, players, el('div', { class: 'mp-actions' }, ...actions));
    lobby.onChange(renderRoster);
    renderRoster();
  }

  function launch(payload, role) {
    const lobby = host ?? client;
    const entry = { map: payload.map, customMap: payload.customMap ?? null, role, code: lobby.code, seed: payload.seed, roster: payload.roster, selfId: net.selfId, lobby };
    closing = true;                 // keep the connection: the game uses it
    host = client = browser = null;
    close();
    closing = false;
    onStart(entry);
  }

  async function close() {
    if (!closing) await teardown();
    root.hidden = true;
    onClose?.();
  }

  return {
    open() { root.hidden = false; say(''); home(); (root.querySelector('.mp-big') ?? nameInput).focus({ preventScroll: true }); },
    close, isOpen: () => !root.hidden,
    items: () => [...root.querySelectorAll('input, select, button')].filter(item => !item.disabled && !item.hidden),
    back: goBack,
  };
}

import { enabledMods } from './mod-store.js';
import { modRuntime } from './runtime.js';

const CSS = `#mod-menu{position:fixed;top:12px;right:12px;z-index:60;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:rgba(10,10,12,.93);border:1px solid #6b6b72;color:#e8e8ea;font:14px/1.3 system-ui,sans-serif}
#mod-menu[hidden]{display:none}#mod-menu header{padding:10px 12px;border-bottom:1px solid #3a3a40;display:flex;justify-content:space-between;gap:8px}
#mod-menu h2{margin:0;font-size:15px;letter-spacing:.06em;text-transform:uppercase}#mod-menu .mm-sub{opacity:.6;font-size:12px}
#mod-menu ul{list-style:none;margin:0;padding:4px 0;overflow:auto}#mod-menu li button{all:unset;box-sizing:border-box;display:flex;justify-content:space-between;gap:12px;width:100%;padding:7px 12px;cursor:pointer}
#mod-menu li button:hover,#mod-menu li button.sel{background:#d9d9de;color:#101012}#mod-menu li button[aria-disabled=true]{opacity:.38}
#mod-menu footer{padding:8px 12px;border-top:1px solid #3a3a40;font-size:12px;min-height:2.6em;opacity:.85}
@media (max-width:600px){#mod-menu{left:12px;right:12px;width:auto}}`;

const step = (item, rt, bindings) => {
  const from = bindings.stepFrom?.[item.command];
  if (from) return Number(rt.values[from]) || (item.min ?? 1);
  return typeof item.step === 'number' ? item.step : 1;
};
const clamp = (value, item) => Math.min(typeof item.max === 'number' ? item.max : Infinity, Math.max(typeof item.min === 'number' ? item.min : -Infinity, value));

// Turns a parsed menu into what can be shown right now: repo order and text, with the repo's runtime-generated
// lists filled from this game's own data.
export function resolveMenu(mod, name, session) {
  const { bindings } = mod;
  const menu = mod.menu.menus[name];
  if (!menu) return [];
  const fill = bindings.menuCommand?.[name];
  const out = [];
  const source = fill ? [{ kind: 'option', dynamic: 'x', command: fill, params: [] }] : menu.items;
  for (const item of source) {
    if (item.dynamic) {
      const made = session && bindings.expand?.[item.command]?.(session);
      if (made) out.push(...made.map(entry => ({ ...item, ...entry, dynamic: undefined, kind: 'option' })));
      continue;
    }
    if (item.submenu && !resolveMenu(mod, item.submenu, session).length) continue;
    out.push(item);
  }
  return out;
}

export const isSupported = (item, bindings) => Boolean(item.submenu || bindings.actions?.[item.command] || bindings.toggles?.[item.command] || bindings.stores?.has(item.command));

export function createModMenu() {
  if (typeof document === 'undefined') return null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.id = 'mod-menu';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Mod menu');
  const title = document.createElement('h2'), sub = document.createElement('span'), list = document.createElement('ul'), foot = document.createElement('footer');
  sub.className = 'mm-sub';
  const head = document.createElement('header');
  head.append(title, sub);
  root.append(head, list, foot);
  document.body.append(root);

  const state = { mod: null, stack: [], index: 0, items: [], local: new Map() };
  const session = () => modRuntime.session;
  const valueOf = (item, key) => state.local.get(key) ?? (item.kind === 'increment' ? (item.start ?? item.min ?? 0) : 0);
  const keyOf = (item, i) => `${state.stack.at(-1)}/${i}/${item.text}`;

  function label(item, i) {
    const { bindings } = state.mod;
    if (item.kind === 'toggle') return [item.text, modRuntime.flags[item.command] ? 'ON' : 'OFF'];
    if (item.kind === 'increment') return [item.text, `◀ ${valueOf(item, keyOf(item, i))} ▶`];
    if (item.kind === 'array') return [item.text, item.values?.length ? `◀ ${item.values[valueOf(item, keyOf(item, i)) % item.values.length]} ▶` : ''];
    return [item.text, item.submenu ? '›' : ''];
  }

  function render() {
    const { mod } = state;
    state.items = resolveMenu(mod, state.stack.at(-1), session());
    state.index = Math.min(state.index, Math.max(0, state.items.length - 1));
    title.textContent = state.stack.at(-1);
    sub.textContent = mod.name;
    list.replaceChildren(...state.items.map((item, i) => {
      const li = document.createElement('li'), button = document.createElement('button'), [left, right] = label(item, i);
      const ok = isSupported(item, mod.bindings);
      button.type = 'button';
      button.className = i === state.index ? 'sel' : '';
      button.setAttribute('aria-disabled', String(!ok));
      button.append(Object.assign(document.createElement('span'), { textContent: left }), Object.assign(document.createElement('span'), { textContent: ok ? right : 'N/A' }));
      button.addEventListener('click', () => { state.index = i; activate(); });
      li.append(button);
      return li;
    }));
    const item = state.items[state.index];
    foot.textContent = !item ? 'Nothing here.' : !isSupported(item, mod.bindings) ? 'This option needs the real Black Ops 3 engine, so it is not available in the browser.' : item.description ?? '';
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function activate() {
    const item = state.items[state.index];
    const { bindings } = state.mod;
    if (!item || !isSupported(item, bindings)) return render();
    if (item.submenu) { state.stack.push(item.submenu); state.index = 0; return render(); }
    const s = session();
    if (!s) { foot.textContent = 'Start a match first.'; return; }
    const value = valueOf(item, keyOf(item, state.index));
    if (item.kind === 'toggle') {
      const on = !modRuntime.flags[item.command];
      modRuntime.flags[item.command] = on;
      if (!on) bindings.toggles[item.command].off?.(s);
    } else if (bindings.stores?.has(item.command)) modRuntime.values[item.command] = value;
    else {
      const picked = item.kind === 'array' ? item.values?.[value % (item.values.length || 1)] : value;
      const result = bindings.actions[item.command](s, item.params ?? [], picked, modRuntime);
      if (result === false) { foot.textContent = 'That is not available right now.'; return; }
    }
    render();
  }

  function adjust(dir) {
    const item = state.items[state.index];
    if (!item || (item.kind !== 'increment' && item.kind !== 'array')) return false;
    const key = keyOf(item, state.index);
    const current = valueOf(item, key);
    if (item.kind === 'array') { const n = item.values?.length ?? 1; state.local.set(key, (current + dir + n) % n); }
    else state.local.set(key, clamp(current + dir * step(item, modRuntime, state.mod.bindings), item));
    render();
    return true;
  }

  function back() {
    if (state.stack.length > 1) { state.stack.pop(); state.index = 0; render(); } else close();
  }

  function open() {
    const mods = enabledMods();
    if (!mods.length) return false;
    state.mod = mods[0];
    state.stack = [state.mod.menu.root];
    state.index = 0;
    document.exitPointerLock?.();
    root.hidden = false;
    render();
    return true;
  }
  function close() { root.hidden = true; }

  addEventListener('keydown', event => {
    const toggleKey = event.code === 'Backquote' || event.code === 'F4';
    if (root.hidden) {
      if (toggleKey && session() && open()) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const n = state.items.length;
    const handled = {
      Backquote: close, F4: close, Escape: back, Backspace: back,
      ArrowDown: () => { state.index = (state.index + 1) % Math.max(1, n); render(); },
      ArrowUp: () => { state.index = (state.index - 1 + Math.max(1, n)) % Math.max(1, n); render(); },
      ArrowRight: () => { if (!adjust(1)) activate(); },
      ArrowLeft: () => { if (!adjust(-1)) back(); },
      Enter: activate, Space: activate,
    }[event.code];
    event.stopPropagation();
    event.preventDefault();
    handled?.();
  }, true);

  return { open, close, isOpen: () => !root.hidden };
}

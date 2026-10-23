import { parseGscMenu } from './gsc-menu-parser.js';
import { synergyBindings } from './synergy-bindings.js';
import { registerMod, setModEnabled, modRuntime } from './runtime.js';

// Where each mod lives. The menu is NOT stored here: it is downloaded from `repo` and parsed on every load.
export const CATALOG = [{
  id: 'synergy',
  name: 'Synergy Mod Menu [Zombies]',
  author: 'SyndiShanX',
  license: 'Open source on GitHub',
  description: 'The Black Ops 3 Zombies GSC mod menu. Downloaded from its repo and parsed live; every option the game can honour works in-match (open it with ` or F4).',
  repo: { owner: 'SyndiShanX', repo: 'Synergy-GSC-Menu', ref: 'main' },
  path: 'BO3/Synergy/scripts/zm/gametypes/_clientids.gsc',
  bindings: synergyBindings,
  workshopId: '3440309449',
}];

export const COOKIE = 'codz-mods';
const YEAR = 31536000;

const browserJar = {
  get: () => (typeof document === 'undefined' ? '' : document.cookie),
  set: value => { if (typeof document !== 'undefined') document.cookie = value; },
};

// Cookie holds only which mods are installed and whether each is enabled, never their content.
export function readInstalled(jar = browserJar) {
  const raw = jar.get().split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`));
  if (!raw) return [];
  try {
    const list = JSON.parse(decodeURIComponent(raw.slice(COOKIE.length + 1)));
    return Array.isArray(list) ? list.filter(e => Array.isArray(e) && CATALOG.some(m => m.id === e[0])).map(([id, on]) => ({ id, enabled: Boolean(on) })) : [];
  } catch { return []; }
}
export function writeInstalled(list, jar = browserJar) {
  jar.set(`${COOKIE}=${encodeURIComponent(JSON.stringify(list.map(e => [e.id, e.enabled ? 1 : 0])))}; path=/; max-age=${YEAR}; SameSite=Lax`);
}

const loaded = new Map(); // id -> { menu } | { error }
const pending = new Map();

const sourceUrl = ({ repo, path }) => `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.ref}/${path.split('/').map(encodeURIComponent).join('/')}`;

export function downloadMod(id, { fetchImpl = globalThis.fetch?.bind(globalThis), force = false } = {}) {
  const mod = CATALOG.find(m => m.id === id);
  if (!mod) return Promise.reject(new Error(`Unknown mod "${id}".`));
  if (!force && loaded.get(id)?.menu) return Promise.resolve(loaded.get(id));
  if (!pending.has(id)) {
    pending.set(id, (async () => {
      const response = await fetchImpl(sourceUrl(mod), force ? { cache: 'reload' } : undefined);
      if (!response.ok) throw new Error(`Could not download ${mod.name} (${response.status}).`);
      const menu = parseGscMenu(await response.text());
      if (!menu.root || !Object.keys(menu.menus).length) throw new Error(`${mod.name} had no menu to read.`);
      const entry = { menu };
      loaded.set(id, entry);
      registerMod(id, mod.bindings, true);
      return entry;
    })().catch(error => { loaded.set(id, { error: error.message }); throw error; }).finally(() => pending.delete(id)));
  }
  return pending.get(id);
}

export const modState = id => {
  const record = readInstalled().find(e => e.id === id);
  return { installed: Boolean(record), enabled: Boolean(record?.enabled), ...(loaded.get(id) ?? {}) };
};

export async function installMod(id, opts = {}) {
  await downloadMod(id, opts);
  const list = readInstalled(opts.jar).filter(e => e.id !== id);
  writeInstalled([...list, { id, enabled: true }], opts.jar);
  setModEnabled(id, true);
}
export function setEnabled(id, enabled, jar) {
  writeInstalled(readInstalled(jar).map(e => e.id === id ? { ...e, enabled } : e), jar);
  setModEnabled(id, enabled);
}
export function uninstallMod(id, jar) {
  writeInstalled(readInstalled(jar).filter(e => e.id !== id), jar);
  setModEnabled(id, false);
  modRuntime.mods.delete(id);
  loaded.delete(id);
}

// Page load: re-download every installed mod right away, in parallel, so it is ready before a match starts.
export function preloadInstalled(opts = {}) {
  const installed = readInstalled(opts.jar);
  return Promise.allSettled(installed.map(async ({ id, enabled }) => {
    await downloadMod(id, opts);
    setModEnabled(id, enabled);
  }));
}
export const enabledMods = () => readInstalled().filter(e => e.enabled && loaded.get(e.id)?.menu).map(e => ({ ...CATALOG.find(m => m.id === e.id), menu: loaded.get(e.id).menu }));

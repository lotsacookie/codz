import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseGscMenu, splitArgs } from '../export/web/assets/js/mods/gsc-menu-parser.js';
import { installMod, setEnabled, uninstallMod, readInstalled, preloadInstalled, modState, COOKIE } from '../export/web/assets/js/mods/mod-store.js';
import { resolveMenu, isSupported } from '../export/web/assets/js/mods/menu-ui.js';
import { modRuntime, tickMods } from '../export/web/assets/js/mods/runtime.js';
import { CATALOG } from '../export/web/assets/js/mods/mod-store.js';
import { Session } from '../export/web/assets/js/rules.js';
import { clearModifiers } from '../export/web/assets/js/modifiers.js';

const SAMPLE = `
function menu_option() {
\tswitch(menu) {
\t\tcase "Root":
\t\t\tself add_option("Basic", undefined, &new_menu, "Basic");
\t\t\t// self add_option("Hidden", undefined, &nothing);
\t\tbreak;
\t\tcase "Basic":
\t\t\tself add_toggle("God Mode", "Makes you ^3Invincible^7", &god_mode, self.syn_god_mode);
\t\t\tself add_increment("Add Points", undefined, &add_points, 500, 500, 100000,
\t\t\t\tself.syn_point_increment);
\t\t\tself add_array("Zombie Color", undefined, &color_zombies, array("None", "Orange"));
\t\t\tforeach(perk in level.perks) self add_option(perk_name, undefined, &give_perk, perk);
\t\tbreak;
\t}
}`;
const fakeJar = () => { let c = ''; return { get: () => c, set: v => { c = v.split(';')[0]; } }; };
const sample = () => Promise.resolve({ ok: true, text: async () => SAMPLE });
const data = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'export/web/assets/game-data.json'), 'utf8'));

test('parser reads menus, kinds, commands and descriptions from the script', () => {
  const r = parseGscMenu(SAMPLE);
  assert.equal(r.root, 'Root');
  assert.equal(r.menus.Root.items[0].submenu, 'Basic');
  const [god, points, color, perk] = r.menus.Basic.items;
  assert.deepEqual([god.kind, god.command, god.description], ['toggle', 'god_mode', 'Makes you Invincible']);
  assert.deepEqual([points.kind, points.min, points.max], ['increment', 500, 100000]); // wrapped over two lines
  assert.deepEqual(color.values, ['None', 'Orange']);
  assert.ok(perk.dynamic && perk.command === 'give_perk');
  assert.deepEqual(splitArgs('"a, b", f(1, 2), &x'), ['"a, b"', 'f(1, 2)', '&x']);
});

test('install saves a cookie, enable/disable/uninstall update it, preload re-downloads', async () => {
  const jar = fakeJar(), fetchImpl = sample;
  await installMod('synergy', { jar, fetchImpl });
  assert.match(jar.get(), new RegExp(`^${COOKIE}=`));
  assert.deepEqual(readInstalled(jar), [{ id: 'synergy', enabled: true }]);
  setEnabled('synergy', false, jar);
  assert.equal(readInstalled(jar)[0].enabled, false);
  let hits = 0;
  await preloadInstalled({ jar, fetchImpl: () => { hits++; return sample(); } });
  assert.ok(hits <= 1);
  uninstallMod('synergy', jar);
  assert.deepEqual(readInstalled(jar), []);
});

test('bindings drive the real session; unbound commands are marked unavailable', async () => {
  clearModifiers();
  const mod = { ...CATALOG[0], menu: parseGscMenu(SAMPLE) };
  const s = new Session(data);
  const items = resolveMenu(mod, 'Basic', s);
  assert.equal(items.filter(i => i.command === 'give_perk').length, Object.keys(data.perkDrinks).length);
  assert.ok(isSupported(items[0], mod.bindings) && !isSupported(items[2], mod.bindings));
  modRuntime.flags.god_mode = true;
  mod.bindings.actions.add_points(s, [], 700);
  assert.equal(s.points, 500 + 700);
  modRuntime.mods.set('synergy', { bindings: mod.bindings, enabled: true });
  tickMods(s, 0.1);
  s.damage(50);
  assert.equal(s.health, 100);
  mod.bindings.actions.give_perkaholic(s);
  assert.equal(s.perks.size, Object.keys(data.perkDrinks).length);
});

test('enabled toggles run from Session.update itself, not only when ticked by hand', () => {
  clearModifiers();
  const mod = CATALOG[0];
  modRuntime.mods.set('synergy', { bindings: mod.bindings, enabled: true });
  const s = new Session(data);
  s.phase = 'fighting';
  modRuntime.flags.god_mode = true;
  modRuntime.flags.infinite_ammo = true;
  s.update(0.1);
  assert.equal(s.damage(40), false);
  s.fireLeft = 0;
  const mag = s.weapon.mag;
  assert.ok(s.fire());
  assert.equal(s.weapon.mag, mag);
  let redraws = 0;
  modRuntime.reequip = () => { redraws++; };
  mod.bindings.actions.give_weapon(s, ['mp40_zm'], 0, modRuntime);
  assert.equal(s.weapon.id, 'mp40_zm');
  assert.equal(redraws, 1);
});

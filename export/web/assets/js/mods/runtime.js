// Bridges enabled mods to the live game session. Node-safe: no DOM at import.
const rt = { session: null, mods: new Map(), flags: {}, values: {} };

export const modRuntime = rt;
export const attachSession = session => { rt.session = session; rt.flags = {}; rt.values = {}; };

// mods: id -> { bindings, enabled }. Bindings declare `tick(session, rt)` per toggle command.
export function registerMod(id, bindings, enabled = true) { rt.mods.set(id, { bindings, enabled }); }
export function setModEnabled(id, enabled) {
  const mod = rt.mods.get(id);
  if (mod) mod.enabled = enabled;
  if (!enabled) { rt.flags = {}; rt.values = {}; }
}
export const activeBindings = () => [...rt.mods.values()].filter(m => m.enabled).map(m => m.bindings);

// Called from Session.update every frame.
export function tickMods(session, dt) {
  if (rt.session !== session) rt.session = session;
  for (const bindings of activeBindings()) {
    for (const [command, on] of Object.entries(rt.flags)) if (on) bindings.toggles?.[command]?.tick?.(session, dt, rt);
  }
}

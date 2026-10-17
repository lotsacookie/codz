// Crash protection for the enemy manager.
//
// Kino never needed this, but Moon and the survival maps spawn through navigation queries, per-map model sets and
// WASM calls. One thrown exception inside Enemies.update used to bubble out of the render loop, so the frame that
// would have drawn the world never ran: everything vanished and the game looked crashed, usually the moment the first
// round (and its first zombie) began. guardEnemies() wraps update/spawn on one instance so that:
//   - a failing spawn removes its half-built zombie and never counts towards the round;
//   - a failing update removes only the zombies that are broken (NaN position, missing rig) and keeps going;
//   - if the same fault keeps repeating the offending zombies are dropped and the round counter is corrected, so the
//     round can still finish instead of waiting for zombies that no longer exist.
export function brokenZombie(z) {
  const p = z?.root?.position;
  return !p || !z.rig || !Number.isFinite(p.x + p.y + p.z);
}

export function guardEnemies(enemies, { onFault = () => {}, maxRepeats = 3 } = {}) {
  if (enemies.guardState) return enemies; // already guarded
  const originalUpdate = enemies.update.bind(enemies);
  const originalSpawn = enemies.spawn.bind(enemies);
  const state = { faults: 0, lastFault: null, repeats: 0, spawnFaults: 0 };
  enemies.guardState = state;

  const drop = z => {
    try { enemies.remove(z); } catch {
      const i = enemies.list.indexOf(z);
      if (i >= 0) enemies.list.splice(i, 1);
      try { z?.root?.removeFromParent(); } catch { /* already detached */ }
    }
    if (enemies.session) enemies.session.spawned = Math.max(0, enemies.session.spawned - 1);
  };

  enemies.purgeBroken = () => { for (const z of [...enemies.list]) if (brokenZombie(z)) drop(z); };

  enemies.spawn = (...args) => {
    const templates = enemies.templates, heads = enemies.heads, before = new Set(enemies.scene?.children ?? []);
    try {
      if (!enemies.templates?.length && !args[2]?.startsWith?.('dog')) {
        // Moon swaps the template set per area; a missing set would make clone(undefined) throw inside spawn.
        const fallback = enemies.lunarBodies?.length ? enemies.lunarBodies : enemies.earthBodies;
        if (fallback?.length) enemies.templates = fallback;
      }
      return originalSpawn(...args);
    } catch (error) {
      state.spawnFaults++; state.lastFault = String(error?.message ?? error);
      if (state.spawnFaults <= 3) console.error('[enemies] spawn failed', error);
      onFault('spawn', error);
      enemies.templates = templates; enemies.heads = heads;
      for (const child of [...(enemies.scene?.children ?? [])]) if (!before.has(child) && /^(zombie|dog|nova|astronaut)_\d+$/.test(child.name)) child.removeFromParent();
      return null;
    }
  };

  enemies.update = (dt, player) => {
    if (!player || !Number.isFinite(player.x + player.y + player.z)) return;
    enemies.purgeBroken();
    try {
      originalUpdate(dt, player);
      state.repeats = 0;
    } catch (error) {
      state.faults++;
      const message = String(error?.message ?? error);
      state.repeats = message === state.lastFault ? state.repeats + 1 : 1;
      state.lastFault = message;
      if (state.faults <= 3) console.error('[enemies] update failed', error);
      onFault('update', error);
      enemies.purgeBroken();
      if (state.repeats >= maxRepeats) {
        // The same exception three frames in a row: some zombie is poisoning the update. Drop the ones that are not
        // mid-spawn so the loop recovers; the round counter is corrected so the round can still end.
        for (const z of [...enemies.list]) if (!['barricade', 'entering'].includes(z.state)) drop(z);
        state.repeats = 0;
      }
    }
  };
  return enemies;
}

import { DogSpawnFx } from './dog-spawn-fx.js';

// Effects Kino had on its own, shared by every map that runs through Combat (Moon, Shangri-La, Ascension, ...):
// blast and drop screen shake, the dog-round lightning that precedes a power-up drop, and wall dust on knife hits.
export function quakeAt(camera, view, position, magnitude = .5, radius = 1000) {
  if (!position || !camera) return false;
  const d = position.distanceTo(camera.position);
  if (d >= radius) return false;
  view?.cameraFx?.build?.(Math.min(1.4, magnitude * 2 * (1 - d / radius) + .15));
  return true;
}

export function installSharedFx(combat, { DogFx = DogSpawnFx, delay = 1500 } = {}) {
  const dogFx = new DogFx(combat.scene, { shake: () => combat.view?.cameraFx?.build?.() });
  const quake = (position, magnitude, radius) => quakeAt(combat.camera, combat.view, position, magnitude, radius);
  combat.quake = quake;
  if (combat.explosions) combat.explosions.onBlast = (p, r) => quake(p, .5, r > 600 ? r : 1000);
  // Lightning strikes first, then the ground shakes and the power-up appears, exactly as in Kino.
  combat.dropPowerup = (type, position) => {
    if (!combat.data?.powerups?.[type] || !position) return;
    const at = position.clone(), session = combat.session;
    dogFx.begin(at);
    setTimeout(() => { if (combat.session !== session) return; quake(at, .5, 1000); combat.pickups.spawn(type, at); }, delay);
  };
  return { dogFx, update: dt => dogFx.update(dt), clear: () => dogFx.clear() };
}

import * as THREE from 'three';

const TRIGGER_NAMES = new Set(['weapon_upgrade', 'claymore_purchase']);
const _trigger = new THREE.Vector3();

function label(trigger) {
  const id = String(trigger.zombie_weapon_upgrade ?? 'weapon').replace(/_zm$/, '').replace(/_/g, ' ');
  return id.toUpperCase();
}

export function createWallGuns({ entities, root, camera, promptElement, offsets = {}, range = 115 }) {
  const nodes = new Map();
  root.traverse(object => {
    const id = object.userData?.entityId;
    if (id === undefined) return;
    if (!nodes.has(id)) nodes.set(id, []);
    nodes.get(id).push(object);
  });
  const guns = [];
  for (const trigger of entities) {
    if (trigger.classname !== 'trigger_use' || !TRIGGER_NAMES.has(trigger.targetname) || !trigger.target) continue;
    const model = entities.find(entity => entity.classname === 'script_model' && entity.targetname === trigger.target);
    const objects = model ? nodes.get(model.id) : null;
    if (!objects?.length) continue;
    const offset = offsets[trigger.id] ?? [0, 0, 0];
    guns.push({
      objects,
      label: label(trigger),
      position: new THREE.Vector3().fromArray(trigger.position).add(new THREE.Vector3().fromArray(offset)),
      shown: false,
    });
  }
  let prompting = null;

  function setShown(gun, shown) {
    gun.shown = shown;
    for (const object of gun.objects) object.visible = shown;
  }

  function setPrompt(text) {
    if (!promptElement || prompting === text) return;
    prompting = text;
    promptElement.textContent = text ?? '';
  }

  function nearest() {
    let best = null, bestDistance = range;
    for (const gun of guns) {
      if (gun.shown) continue;
      _trigger.copy(gun.position);
      const distance = camera.position.distanceTo(_trigger);
      if (distance < bestDistance) { best = gun; bestDistance = distance; }
    }
    return best;
  }

  function reset() {
    for (const gun of guns) setShown(gun, false);
    setPrompt(null);
  }

  function update() {
    const gun = nearest();
    setPrompt(gun ? `E · Take ${gun.label}` : null);
  }

  function interact() {
    const gun = nearest();
    if (!gun) return false;
    setShown(gun, true);
    setPrompt(null);
    return true;
  }

  reset();
  return { guns, reset, update, interact, count: guns.length };
}

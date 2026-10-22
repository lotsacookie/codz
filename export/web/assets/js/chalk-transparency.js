import * as THREE from 'three';

const CHALK = /(?:^|[/:])chalk_weapon_/i;
const seen = new WeakSet();

function chalkName(material) {
  const name = material.userData?.sourceMaterialNames?.[0] || material.name || '';
  return !name.startsWith('*') && CHALK.test(name);
}

export function applyChalkTransparency(root) {
  let count = 0;
  root.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || seen.has(material) || !chalkName(material)) continue;
      seen.add(material);
      material.transparent = true;
      material.blending = THREE.AdditiveBlending;
      material.depthWrite = false;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -2;
      material.needsUpdate = true;
      object.renderOrder = Math.max(object.renderOrder, 1);
      count++;
    }
  });
  return count;
}

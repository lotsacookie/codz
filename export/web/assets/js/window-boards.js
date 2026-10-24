import * as THREE from 'three';

// Kino der Toten's window boards: the same plank sizes, tilt, layout and wood texture, fitted onto any window.
// Shared by the BSP/custom maps and the One Window Challenge so no map invents its own placeholder planks.
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
let kinoBoards = null;

export async function loadKinoBoards() {
  if (kinoBoards) return kinoBoards;
  const template = await (await fetch(new URL('../custom-maps/window-boards.json', import.meta.url))).json();
  const { assetManager } = await import('./runtime-assets.js');
  const texture = await new Promise(resolve => new THREE.TextureLoader(assetManager).load(template.texture, resolve, undefined, () => resolve(null)));
  if (texture) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  } else console.warn('[window-boards] Kino board texture unavailable');
  const material = new THREE.MeshStandardMaterial({ color: texture ? 0xffffff : 0x7a5a3a, map: texture, roughness: .95, metalness: 0 });
  return kinoBoards = { ...template, material };
}

export function boardGeometry(size) {
  const geometry = new THREE.BoxGeometry(...size);
  const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const axes = [0, 1, 2].filter(a => Math.abs(normal.getComponent(i, a)) < .5);
    uv.setXY(i, position.getComponent(i, axes[0]) / 96, position.getComponent(i, axes[1]) / 96);
  }
  return geometry;
}

// Adds one script_model entity and one textured plank per Kino board. The window is described by the centre of its
// opening on the floor (x, y, z), the unit tangent along the wall `t` [x, z], the wall normal `n` [x, z] pointing into
// the room, the opening `width`, and the `sill` and `top` heights above the floor.
export function placeKinoBoards(kino, { add, scene, name, x: cx, y: cy, z: cz, t, n, width, sill, top }) {
  const ku = (width + 8) / kino.width, ky = (top - sill) / kino.height;
  // Window frame: X along the wall, Y up, Z out of the window (away from the room).
  const outward = new THREE.Vector3(-n[0], 0, -n[1]);
  const along = new THREE.Vector3().crossVectors(UP, outward);
  const frameQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, UP, outward));
  const ids = [];
  kino.boards.forEach((spec, k) => {
    const vertical = Math.abs(Math.sin(spec.angle * Math.PI / 180)) > .7;
    const length = spec.length * (vertical ? ky : ku);
    const u = spec.u * ku, v = spec.v - 2.5;
    const x = cx + t[0] * u + outward.x * v, z = cz + t[1] * u + outward.z * v;
    const y = cy + sill + spec.y * ky;
    const entity = add({ classname: 'script_model', targetname: name, script_parameters: 'board', script_noteworthy: String(k + 1), position: [x, y, z], yaw: 0, plank: spec.width });
    const board = new THREE.Mesh(boardGeometry([length, spec.width, spec.thick]), kino.material);
    board.quaternion.copy(frameQuat).multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD, spec.angle * Math.PI / 180));
    board.position.set(x, y, z);
    board.userData.entityId = entity.id;
    scene.add(board);
    ids.push(entity.id);
  });
  return ids;
}

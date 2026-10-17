import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MOON_PERKS } from './moon-session.js';

export const ROOM = { minX: -500, maxX: 500, minZ: -300, maxZ: 300, height: 220, wall: 24 };
export const WINDOW = { halfWidth: 60, sill: 36, top: 120, boards: 6, boardX: -512 };
export const CLOSET = { minX: -724, halfDepth: 100 };
export const SPAWN = { position: [380, 2, 0], yaw: Math.PI };
export const OUTSIDE = [-590, 0, 0];
export const INSIDE = [-470, 0, 0];
export const REPAIR_POINT = [-488, 60, 0];
export const SKY_FACES = ['textures/sky-px.png', 'textures/sky-nx.png', 'textures/sky-py.png', 'textures/sky-ny.png', 'textures/sky-pz.png', 'textures/sky-nz.png'];

const MACHINE = { width: 52, depth: 26, height: 78, pitch: 80, firstX: -320 };
const PACK = { width: 64, depth: 40, height: 88, x: 330 };
const CHEST = { x: 250, halfWidth: 35, depth: 30, height: 26, lidDepth: 28 };

export const PERK_IDS = Object.keys(MOON_PERKS);

const solid = (min, max) => ({ min, max });

export const OBSTACLES = [
  ...PERK_IDS.map((id, i) => {
    const x = MACHINE.firstX + i * MACHINE.pitch;
    return solid([x - MACHINE.width / 2, 0, ROOM.maxZ - MACHINE.depth], [x + MACHINE.width / 2, MACHINE.height, ROOM.maxZ]);
  }),
  solid([PACK.x - PACK.width / 2, 0, ROOM.maxZ - PACK.depth], [PACK.x + PACK.width / 2, PACK.height, ROOM.maxZ]),
  solid([CHEST.x - CHEST.halfWidth, 0, ROOM.minZ], [CHEST.x + CHEST.halfWidth, CHEST.height, ROOM.minZ + CHEST.depth]),
];

export const PATH_POINTS = (() => {
  const points = [];
  for (let x = -400; x <= 400; x += 100) for (let z = -200; z <= 200; z += 100) points.push([x, 0, z]);
  points.push([INSIDE[0], 0, 0]);
  return points;
})();

const H = ROOM.height;
const T = ROOM.wall;
const FLOOR_DEPTH = 20;

const WALLS = [
  [[ROOM.minX - T, 0, ROOM.minZ - T], [ROOM.maxX + T, H, ROOM.minZ]],
  [[ROOM.minX - T, 0, ROOM.maxZ], [ROOM.maxX + T, H, ROOM.maxZ + T]],
  [[ROOM.maxX, 0, ROOM.minZ - T], [ROOM.maxX + T, H, ROOM.maxZ + T]],
  [[ROOM.minX - T, 0, ROOM.minZ - T], [ROOM.minX, H, -WINDOW.halfWidth]],
  [[ROOM.minX - T, 0, WINDOW.halfWidth], [ROOM.minX, H, ROOM.maxZ + T]],
  [[ROOM.minX - T, 0, -WINDOW.halfWidth], [ROOM.minX, WINDOW.sill, WINDOW.halfWidth]],
  [[ROOM.minX - T, WINDOW.top, -WINDOW.halfWidth], [ROOM.minX, H, WINDOW.halfWidth]],
  [[CLOSET.minX - T, 0, -CLOSET.halfDepth - T], [ROOM.minX - T, H, -CLOSET.halfDepth]],
  [[CLOSET.minX - T, 0, CLOSET.halfDepth], [ROOM.minX - T, H, CLOSET.halfDepth + T]],
  [[CLOSET.minX - T, 0, -CLOSET.halfDepth - T], [CLOSET.minX, H, CLOSET.halfDepth + T]],
];

const FLOORS = [
  [[ROOM.minX - T, -FLOOR_DEPTH, ROOM.minZ - T], [ROOM.maxX + T, 0, ROOM.maxZ + T]],
  [[CLOSET.minX - T, -FLOOR_DEPTH, -CLOSET.halfDepth - T], [ROOM.minX - T, 0, CLOSET.halfDepth + T]],
];

function boxGeometry(min, max) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const geometry = new THREE.BoxGeometry(...size);
  geometry.translate(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
  return geometry;
}

function worldUV(geometry, scale) {
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    let u, v;
    if (Math.abs(normal.getY(i)) > .5) { u = position.getX(i); v = position.getZ(i); }
    else if (Math.abs(normal.getX(i)) > .5) { u = position.getZ(i); v = position.getY(i); }
    else { u = position.getX(i); v = position.getY(i); }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function tileTexture(base, grout, seed) {
  if (typeof document === 'undefined') return null;
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  let state = seed;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 520; i++) {
    g.fillStyle = `rgba(${random() > .5 ? '255,255,255' : '0,0,0'},${(random() * .07).toFixed(3)})`;
    g.fillRect(random() * size, random() * size, 1 + random() * 5, 1 + random() * 5);
  }
  g.strokeStyle = grout;
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, size - 3, size - 3);
  g.beginPath();
  g.moveTo(size / 2, 0);
  g.lineTo(size / 2, size / 2);
  g.moveTo(0, size / 2);
  g.lineTo(size, size / 2);
  g.moveTo(size / 4, size / 2);
  g.lineTo(size / 4, size);
  g.moveTo((size * 3) / 4, size / 2);
  g.lineTo((size * 3) / 4, size);
  g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function material(name, color, texture, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color: texture ? 0xffffff : color, map: texture, roughness: .92, metalness: 0, ...extra });
  m.name = name;
  return m;
}

function perkMachine(id, x) {
  const perk = MOON_PERKS[id];
  const color = new THREE.Color(perk.color);
  const group = new THREE.Group();
  group.name = 'owc_' + id;
  const body = new THREE.Mesh(boxGeometry([x - MACHINE.width / 2, 0, ROOM.maxZ - MACHINE.depth], [x + MACHINE.width / 2, MACHINE.height - 6, ROOM.maxZ]), material('owc_machine_' + id, color.clone().multiplyScalar(.5), null, { roughness: .55, metalness: .25 }));
  const cap = new THREE.Mesh(boxGeometry([x - MACHINE.width / 2 - 2, MACHINE.height - 6, ROOM.maxZ - MACHINE.depth - 2], [x + MACHINE.width / 2 + 2, MACHINE.height, ROOM.maxZ]), material('owc_cap_' + id, 0x1b1d20, null, { roughness: .7 }));
  const panel = new THREE.Mesh(boxGeometry([x - MACHINE.width / 2 + 6, 22, ROOM.maxZ - MACHINE.depth - 1], [x + MACHINE.width / 2 - 6, 62, ROOM.maxZ - MACHINE.depth]), material('owc_panel_' + id, color, null, { emissive: color, emissiveIntensity: .85, roughness: .4 }));
  group.add(body, cap, panel);
  return group;
}

function packMachine() {
  const group = new THREE.Group();
  group.name = 'owc_pack_a_punch';
  const z0 = ROOM.maxZ - PACK.depth, x0 = PACK.x - PACK.width / 2, x1 = PACK.x + PACK.width / 2;
  const blue = new THREE.Color(0x3b78d8);
  const body = new THREE.Mesh(boxGeometry([x0, 0, z0], [x1, PACK.height - 8, ROOM.maxZ]), material('owc_pack_body', 0x23324f, null, { roughness: .5, metalness: .35 }));
  const cap = new THREE.Mesh(boxGeometry([x0 - 3, PACK.height - 8, z0 - 3], [x1 + 3, PACK.height, ROOM.maxZ]), material('owc_pack_cap', 0x14171d, null, { roughness: .6 }));
  const panel = new THREE.Mesh(boxGeometry([x0 + 8, 20, z0 - 1], [x1 - 8, 70, z0]), material('owc_pack_panel', blue, null, { emissive: blue, emissiveIntensity: 1, roughness: .35 }));
  const slot = new THREE.Mesh(boxGeometry([x0 + 22, 38, z0 - 2], [x1 - 22, 48, z0 - 1]), material('owc_pack_slot', 0x05070a, null));
  group.add(body, cap, panel, slot);
  return group;
}

export async function buildWorld() {
  const entities = [];
  const add = entity => { const record = { id: entities.length, ...entity }; entities.push(record); return record; };

  add({ classname: 'info_player_start', position: SPAWN.position, yaw: SPAWN.yaw });

  add({ classname: 'trigger_multiple', targetname: 'exterior_goal', target: 'owc_window', position: OUTSIDE });
  add({ classname: 'script_struct', targetname: 'owc_window', position: INSIDE });
  const boardIds = [];
  const plank = (WINDOW.top - WINDOW.sill - 8) / WINDOW.boards;
  for (let i = 0; i < WINDOW.boards; i++) {
    const y = WINDOW.sill + 4 + plank * (i + .5);
    boardIds.push(add({ classname: 'script_model', targetname: 'owc_window', script_parameters: 'board', script_noteworthy: String(i + 1), position: [WINDOW.boardX, y, 0], yaw: 0, plank: plank - 2 }).id);
  }

  const chestFrontZ = ROOM.minZ + CHEST.depth;
  const lidEntity = add({ classname: 'script_model', targetname: 'owc_chest_lid', position: [CHEST.x, CHEST.height, ROOM.minZ + 1], yaw: Math.PI });
  const baseEntity = add({ classname: 'script_model', targetname: 'owc_chest_box', position: [CHEST.x, 0, ROOM.minZ], yaw: 0 });
  add({ classname: 'script_struct', targetname: 'owc_chest_org', position: [CHEST.x, CHEST.height - 2, ROOM.minZ + CHEST.depth / 2], yaw: -Math.PI / 2 });
  add({ classname: 'trigger_use', targetname: 'treasure_chest_use', target: 'owc_chest_org', script_noteworthy: 'owc_chest', position: [CHEST.x, 18, chestFrontZ + 6], yaw: 0 });

  PERK_IDS.forEach((id, i) => add({ classname: 'trigger_use', targetname: 'zombie_vending_perk', script_noteworthy: id, position: [MACHINE.firstX + i * MACHINE.pitch, 36, ROOM.maxZ - MACHINE.depth - 4], yaw: Math.PI }));
  add({ classname: 'trigger_use', targetname: 'zombie_vending_upgrade', position: [PACK.x, 36, ROOM.maxZ - PACK.depth - 4], yaw: Math.PI });

  const scene = new THREE.Group();
  scene.name = 'one_window_challenge';

  const stone = tileTexture('#8d8574', '#4f4a40', 7);
  const floorTexture = tileTexture('#6c675d', '#3d3a34', 21);
  const wallMaterial = material('owc_wall', 0x8d8574, stone);
  const floorMaterial = material('owc_floor', 0x6c675d, floorTexture);
  const wallGeometry = worldUV(mergeGeometries(WALLS.map(([min, max]) => boxGeometry(min, max)), false), 1 / 128);
  const floorGeometry = worldUV(mergeGeometries(FLOORS.map(([min, max]) => boxGeometry(min, max)), false), 1 / 128);
  scene.add(new THREE.Mesh(wallGeometry, wallMaterial), new THREE.Mesh(floorGeometry, floorMaterial));

  PERK_IDS.forEach((id, i) => scene.add(perkMachine(id, MACHINE.firstX + i * MACHINE.pitch)));
  scene.add(packMachine());

  const wood = material('owc_wood', 0x7a5a3a, null, { roughness: .95 });
  boardIds.forEach(id => {
    const e = entities[id];
    const board = new THREE.Mesh(new THREE.BoxGeometry(6, e.plank, WINDOW.halfWidth * 2 + 6), wood);
    board.position.set(...e.position);
    board.userData.entityId = id;
    scene.add(board);
  });

  const chestWood = material('owc_chest', 0x5b3b22, null, { roughness: .8 });
  const chestBase = new THREE.Mesh(boxGeometry([CHEST.x - CHEST.halfWidth, 0, ROOM.minZ], [CHEST.x + CHEST.halfWidth, CHEST.height, ROOM.minZ + CHEST.depth]), chestWood);
  chestBase.userData.entityId = baseEntity.id;
  const lid = new THREE.Group();
  lid.position.set(...lidEntity.position);
  lid.rotation.y = Math.PI;
  lid.userData.entityId = lidEntity.id;
  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(CHEST.halfWidth * 2, 4, CHEST.lidDepth), chestWood);
  lidMesh.position.set(0, 2, -CHEST.lidDepth / 2);
  lid.add(lidMesh);
  scene.add(chestBase, lid);

  const solids = [...WALLS, ...FLOORS, ...OBSTACLES.map(o => [o.min, o.max])];
  const collisionGeometry = mergeGeometries(solids.map(([min, max]) => boxGeometry(min, max)), false);
  collisionGeometry.deleteAttribute('normal');
  collisionGeometry.deleteAttribute('uv');
  collisionGeometry.computeBoundingBox();

  const data = {
    map: 'one_window_challenge',
    title: 'One Window Challenge',
    stage: 'generated',
    spawn: { position: SPAWN.position, yaw: SPAWN.yaw, entity: 0 },
    entities,
    worldspawn: {},
    materialRules: {},
    hiddenEntities: [],
    sky: { faces: SKY_FACES },
    source: { generated: true },
  };
  const bounds = collisionGeometry.boundingBox;
  const collisionMetadata = { format: 'runtime-bvh', bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
  return { data, scene, collisionGeometry, collisionMetadata };
}

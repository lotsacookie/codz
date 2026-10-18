import * as THREE from 'three';
import { MOON_PERKS } from '../moon-session.js';
import { flattenObject, fitModel, applyFit, appendBoxes, addGround } from './geometry.js';
import { createProbe, planLevel } from './analyze.js';
import { planFromLayout } from './bsp-plan.js';
import { addMapLights } from './lights.js';

export const SKY_FACES = ['textures/sky-px.png', 'textures/sky-nx.png', 'textures/sky-py.png', 'textures/sky-ny.png', 'textures/sky-pz.png', 'textures/sky-nz.png'];
export const PERK_IDS = Object.keys(MOON_PERKS);

const ORDER = ['specialty_quickrevive', 'specialty_armorvest', 'specialty_fastreload', 'chest', 'specialty_rof', 'specialty_longersprint', 'specialty_flakjacket', 'specialty_deadshot', 'specialty_additionalprimaryweapon', 'pack'];
export const ROLES = [...ORDER.filter(role => role === 'chest' || role === 'pack' || PERK_IDS.includes(role)), ...PERK_IDS.filter(id => !ORDER.includes(id))];

const WINDOW = { boards: 6, sill: 6, top: 104, thickness: 6 };
const MACHINE = { size: [52, 78, 26] };
const PACK = { size: [64, 88, 40] };
const CHEST = { width: 70, height: 26, depth: 30, lidDepth: 28 };
const LID_OFFSET = [0, 17, 12];
const PERK_MODELS = {
  specialty_quickrevive: 'models/zombie_vending_revive.glb',
  specialty_armorvest: 'models/zombie_vending_jugg.glb',
  specialty_fastreload: 'models/zombie_vending_sleight.glb',
  specialty_rof: 'models/zombie_vending_doubletap.glb',
  specialty_additionalprimaryweapon: 'moon/models/zombie_vending_three_gun.glb',
  specialty_longersprint: 'models/zombie_vending_marathon.glb',
  specialty_flakjacket: 'models/zombie_vending_nuke.glb',
  specialty_deadshot: 'models/zombie_vending_ads.glb',
};
const PACK_MODEL = 'models/zombie_vending_packapunch.glb';
const CHEST_MODEL = 'models/zombie_treasure_box.glb';
const CHEST_LID_MODEL = 'models/zombie_treasure_box_lid.glb';

async function tryLoad(loadModel, url) {
  if (!loadModel || !url) return null;
  try { return await loadModel(url); } catch (error) { console.warn('[custom-map] model unavailable, using blocks:', url, error?.message ?? error); return null; }
}

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .9, metalness: 0, ...extra });

function seat(model, { yaw, anchor, normal, floorY }) {
  const group = new THREE.Group();
  model.rotation.y = yaw;
  group.add(model);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const [nx, nz] = normal;
  const shift = new THREE.Vector3(0, floorY - box.min.y, 0);
  if (nx !== 0) {
    shift.x = anchor[0] - (nx > 0 ? box.min.x : box.max.x);
    shift.z = anchor[1] - (box.min.z + box.max.z) / 2;
  } else {
    shift.z = anchor[1] - (nz > 0 ? box.min.z : box.max.z);
    shift.x = anchor[0] - (box.min.x + box.max.x) / 2;
  }
  group.position.copy(shift);
  group.updateMatrixWorld(true);
  return { group, box: new THREE.Box3().setFromObject(group) };
}

function blockMachine(site, color, [w, h, d]) {
  const [nx, nz] = site.normal;
  const alongX = nx !== 0;
  const sx = alongX ? d : w, sz = alongX ? w : d;
  const cx = site.anchor[0] + nx * d / 2, cz = site.anchor[1] + nz * d / 2;
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(sx, h - 6, sz), material(color.clone().multiplyScalar(.5), { roughness: .55, metalness: .25 }));
  body.position.set(cx, site.y + (h - 6) / 2, cz);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(sx + 4, 6, sz + 4), material(0x1b1d20, { roughness: .7 }));
  cap.position.set(cx, site.y + h - 3, cz);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1 : w - 12, 40, alongX ? w - 12 : 1), material(color, { emissive: color, emissiveIntensity: .85, roughness: .4 }));
  panel.position.set(cx + nx * (d / 2 + .5), site.y + 42, cz + nz * (d / 2 + .5));
  group.add(body, cap, panel);
  group.updateMatrixWorld(true);
  return { group, box: new THREE.Box3().setFromObject(group) };
}

function depthOf(box, normal) {
  const size = box.getSize(new THREE.Vector3());
  return normal[0] !== 0 ? size.x : size.z;
}

function placeMachine(site, model, add, scene, solids) {
  const pack = site.role === 'pack';
  const color = new THREE.Color(pack ? 0x3b78d8 : MOON_PERKS[site.role].color);
  const yaw = Math.atan2(site.normal[0], site.normal[1]);
  const seated = model ? seat(model, { yaw, anchor: site.anchor, normal: site.normal, floorY: site.y }) : blockMachine(site, color, pack ? PACK.size : MACHINE.size);
  scene.add(seated.group);
  solids.push(seated.box.clone());
  const reach = depthOf(seated.box, site.normal) + 4;
  const position = [site.anchor[0] + site.normal[0] * reach, site.y + 36, site.anchor[1] + site.normal[1] * reach];
  if (pack) add({ classname: 'trigger_use', targetname: 'zombie_vending_upgrade', position, yaw });
  else add({ classname: 'trigger_use', targetname: 'zombie_vending_perk', script_noteworthy: site.role, position, yaw });
}

function placeChest(site, models, add, scene, solids) {
  const [boxModel, lidModel] = models;
  const [nx, nz] = site.normal;
  const yaw = Math.atan2(-nx, -nz);
  const lidEntity = add({ classname: 'script_model', targetname: 'cm_chest_lid', position: [site.anchor[0], site.y + CHEST.height, site.anchor[1]], yaw });
  const baseEntity = add({ classname: 'script_model', targetname: 'cm_chest_box', position: [site.anchor[0], site.y, site.anchor[1]], yaw });
  const orgEntity = add({ classname: 'script_struct', targetname: 'cm_chest_org', position: [site.anchor[0], site.y + CHEST.height - 2, site.anchor[1]], yaw: yaw - Math.PI * 1.5 });
  const lid = new THREE.Group();
  lid.rotation.y = yaw;
  lid.userData.entityId = lidEntity.id;
  let base, box, depth;
  if (boxModel && lidModel) {
    const seated = seat(boxModel, { yaw, anchor: site.anchor, normal: site.normal, floorY: site.y });
    base = new THREE.Group();
    base.add(seated.group);
    const origin = boxModel.getWorldPosition(new THREE.Vector3());
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    lid.position.set(origin.x + LID_OFFSET[0] * cos + LID_OFFSET[2] * sin, origin.y + LID_OFFSET[1], origin.z - LID_OFFSET[0] * sin + LID_OFFSET[2] * cos);
    lid.add(lidModel);
    box = seated.box;
    const center = box.getCenter(new THREE.Vector3());
    orgEntity.position = [center.x, box.max.y - 2, center.z];
  } else {
    const alongX = nx !== 0;
    const size = alongX ? [CHEST.depth, CHEST.height, CHEST.width] : [CHEST.width, CHEST.height, CHEST.depth];
    base = new THREE.Mesh(new THREE.BoxGeometry(...size), material(0x5b3b22, { roughness: .8 }));
    base.position.set(site.anchor[0] + nx * CHEST.depth / 2, site.y + CHEST.height / 2, site.anchor[1] + nz * CHEST.depth / 2);
    lid.position.set(site.anchor[0] + nx, site.y + CHEST.height, site.anchor[1] + nz);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(CHEST.width, 4, CHEST.lidDepth), material(0x5b3b22, { roughness: .8 }));
    lidMesh.position.set(0, 2, -CHEST.lidDepth / 2);
    lid.add(lidMesh);
    base.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(base);
  }
  depth = depthOf(box, site.normal);
  base.userData.entityId = baseEntity.id;
  lidEntity.position = lid.position.toArray();
  scene.add(base, lid);
  solids.push(box.clone());
  add({
    classname: 'trigger_use', targetname: 'treasure_chest_use', target: 'cm_chest_org', script_noteworthy: 'cm_chest',
    position: [site.anchor[0] + nx * (depth + 6), site.y + 18, site.anchor[1] + nz * (depth + 6)], yaw,
  });
}

// Kino der Toten's window boards (same plank sizes, tilt, layout and wood texture), fitted onto each window.
let kinoBoards = null;
async function loadKinoBoards() {
  if (kinoBoards) return kinoBoards;
  const template = await (await fetch(new URL('./window-boards.json', import.meta.url))).json();
  const { assetManager } = await import('../runtime-assets.js');
  const texture = await new Promise(resolve => new THREE.TextureLoader(assetManager).load(template.texture, resolve, undefined, () => resolve(null)));
  if (texture) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  } else console.warn('[custom-map] Kino board texture unavailable');
  return kinoBoards = { ...template, material: material(texture ? 0xffffff : 0x7a5a3a, { map: texture, roughness: .95 }) };
}

function boardGeometry(size) {
  const geometry = new THREE.BoxGeometry(...size);
  const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const axes = [0, 1, 2].filter(a => Math.abs(normal.getComponent(i, a)) < .5);
    uv.setXY(i, position.getComponent(i, axes[0]) / 96, position.getComponent(i, axes[1]) / 96);
  }
  return geometry;
}

const UP = new THREE.Vector3(0, 1, 0);

function placeWindow(w, index, add, scene, kino) {
  const name = `cm_window_${index}`;
  add({ classname: 'trigger_multiple', targetname: 'exterior_goal', target: name, position: w.outside, repair: w.repair, spawn: w.spawnPoint ?? undefined });
  add({ classname: 'script_struct', targetname: name, position: w.inside });
  const ku = (w.width + 8) / kino.width, ky = (WINDOW.top - WINDOW.sill) / kino.height;
  // Window frame: X along the wall, Y up, Z out of the window (away from the room).
  const outward = new THREE.Vector3(-w.n[0], 0, -w.n[1]);
  const along = new THREE.Vector3().crossVectors(UP, outward);
  const frameQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, UP, outward));
  kino.boards.forEach((spec, k) => {
    const vertical = Math.abs(Math.sin(spec.angle * Math.PI / 180)) > .7;
    const length = spec.length * (vertical ? ky : ku);
    const u = spec.u * ku, v = spec.v - 2.5;
    const x = w.x + w.t[0] * u + outward.x * v, z = w.z + w.t[1] * u + outward.z * v;
    const y = w.y + WINDOW.sill + spec.y * ky;
    const entity = add({ classname: 'script_model', targetname: name, script_parameters: 'board', script_noteworthy: String(k + 1), position: [x, y, z], yaw: 0, plank: spec.width });
    const board = new THREE.Mesh(boardGeometry([length, spec.width, spec.thick]), kino.material);
    board.quaternion.copy(frameQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spec.angle * Math.PI / 180));
    board.position.set(x, y, z);
    board.userData.entityId = entity.id;
    scene.add(board);
  });
}


// NZ:P layout points are in the model's raw space; move them into the fitted world.
function toWorldLayout(hints, fit) {
  const point = ([x, y, z]) => [x * fit.scale + fit.offset.x, y * fit.scale + fit.offset.y, z * fit.scale + fit.offset.z];
  return {
    spawn: hints.spawn && { point: point(hints.spawn.point), yaw: hints.spawn.yaw },
    sites: hints.sites.map(site => ({ ...site, point: point(site.point) })),
    windows: hints.windows.map(w => ({ ...w, point: point(w.point), spawner: w.spawner && point(w.spawner) })),
    lights: (hints.lights ?? []).map(light => ({ ...light, point: point(light.point) })),
    doors: hints.doors.map(door => ({ ...door, min: point(door.min), max: point(door.max) })),
  };
}

function placeDoor(door, fit, add, scene) {
  const matrix = new THREE.Matrix4().compose(fit.offset, new THREE.Quaternion(), new THREE.Vector3(fit.scale, fit.scale, fit.scale));
  door.object.traverse(node => { if (node.isMesh) node.geometry.applyMatrix4(matrix); });
  const [cx, , cz] = door.center;
  add({ classname: 'trigger_use', targetname: 'zombie_door', target: door.name, zombie_cost: String(door.cost), position: [cx, door.min[1] + 40, cz] });
  const part = add({ classname: 'script_model', targetname: door.name, position: [cx, door.min[1], cz], yaw: 0 });
  door.object.userData.entityId = part.id;
  scene.add(door.object);
}

export async function createCustomWorld(root, { onStatus = () => {}, scale = null, loadModel, label = 'Custom Map' } = {}) {
  onStatus('Reading the model…', .06);
  let flat = flattenObject(root);
  if (!flat.triangles) throw new Error('This model has no visible geometry to walk on.');
  const fit = fitModel(flat.box, { scale });
  applyFit(flat, fit);
  const scene = new THREE.Group();
  scene.name = 'custom_map';
  const fitted = new THREE.Group();
  fitted.scale.setScalar(fit.scale);
  fitted.position.copy(fit.offset);
  fitted.add(root);
  if (root.userData?.bspProps) fitted.add(root.userData.bspProps);
  scene.add(fitted);

  onStatus('Building collision…', .08);
  let probe = createProbe(flat.positions, flat.index);
  const hints = root.userData?.bspLayout ?? null;
  const worldLayout = hints ? toWorldLayout(hints, fit) : null;
  const makePlan = async () => (worldLayout && await planFromLayout(probe, flat.box, worldLayout, { roles: ROLES, onStatus })) || planLevel(probe, flat.box, { roles: ROLES, onStatus });
  let plan = await makePlan();
  if (plan.failed) {
    onStatus('No floor found, adding ground…', .1);
    flat = addGround(flat);
    const slab = flat.ground;
    const ground = new THREE.Mesh(new THREE.BoxGeometry(slab.max.x - slab.min.x, slab.max.y - slab.min.y, slab.max.z - slab.min.z), material(0x5d6157));
    ground.position.copy(slab.getCenter(new THREE.Vector3()));
    scene.add(ground);
    probe = createProbe(flat.positions, flat.index);
    plan = await makePlan();
    if (plan.failed) throw new Error('Could not find a walkable floor in this model.');
  }

  addMapLights(scene, worldLayout?.lights);
  onStatus('Setting up windows, perks and the box…', .78);
  if (loadModel === undefined) {
    try { ({ loadModel } = await import('../animation.js')); } catch (error) { console.warn('[custom-map] model loader unavailable', error); loadModel = null; }
  }
  const entities = [];
  const add = entity => {
    const record = { id: entities.length, ...entity };
    entities.push(record);
    return record;
  };
  add({ classname: 'info_player_start', position: plan.spawn.position, yaw: plan.spawn.yaw });
  const solids = [];
  const kino = plan.windows.length ? await loadKinoBoards() : null;
  plan.windows.forEach((w, i) => placeWindow(w, i, add, scene, kino));
  for (const door of plan.doors ?? []) placeDoor(door, fit, add, scene);
  const loaded = await Promise.all(plan.sites.map(site => {
    if (site.role === 'chest') return Promise.all([tryLoad(loadModel, CHEST_MODEL), tryLoad(loadModel, CHEST_LID_MODEL)]);
    return tryLoad(loadModel, site.role === 'pack' ? PACK_MODEL : PERK_MODELS[site.role]);
  }));
  plan.sites.forEach((site, i) => {
    if (site.role === 'chest') placeChest(site, loaded[i], add, scene, solids);
    else placeMachine(site, loaded[i], add, scene, solids);
  });
  if (!entities.some(e => e.targetname === 'treasure_chest_use')) console.warn('[custom-map] no spot found for the Mystery Box');

  plan.grid.kill((node, i) => i !== plan.spawn.index && solids.some(b => node.x > b.min.x - 18 && node.x < b.max.x + 18 && node.z > b.min.z - 18 && node.z < b.max.z + 18 && node.y > b.min.y - 40 && node.y < b.max.y + 20));
  plan.grid.recompute();

  const merged = appendBoxes(flat, solids);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(merged.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(merged.index, 1));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const data = {
    map: 'custom_map', title: label, stage: 'generated',
    spawn: { position: plan.spawn.position, yaw: plan.spawn.yaw, entity: 0 },
    entities, worldspawn: {}, materialRules: {}, hiddenEntities: [], sky: { faces: SKY_FACES }, environment: hints?.environment ?? null, source: { generated: true, custom: true },
  };
  return {
    data, scene, collisionGeometry: geometry,
    collisionMetadata: { format: 'runtime-bvh', bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } },
    layout: { grid: plan.grid, spawn: plan.spawn, windows: plan.windows, sites: plan.sites, fit, triangles: flat.triangles, doors: (plan.doors ?? []).map(door => ({ ids: door.ids, center: new THREE.Vector3(...door.center), closed: true })) },
  };
}

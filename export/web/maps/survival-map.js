import * as THREE from 'three';
import { loadMapGltf, settleTextures, textureWarning } from '../map-assets.js';
import { preloadShared } from '../shared-assets.js';
import { CollisionWorld, loadCollisionWorld } from '../collision-world.js';
import { PlayerController } from '../player-controller.js';
import { optimizeStaticScene } from '../scene-optimizer.js';
import { disposeObject } from '../dispose.js';
import { applyChalkTransparency } from '../chalk-transparency.js';
import { bindExploreGraphics } from '../explore-graphics.js';
import { ChalkHud, powerupVisible, spawnScorePopup, renderAmmoIcons } from '../hud.js';
import { createZombieTouch } from '../zombies-touch.js';
import { MoonCombat } from '../moon-combat.js';
import { MOON_PERKS } from '../moon-session.js';
import { ShangriSession } from '../shangri-la-session.js';
import { ShangriEnemies } from '../shangri-la-enemies.js';
import { ShangriFeatures } from '../shangri-la-features.js';
import { SurvivalNavigation } from '../shangri-la-navigation.js';
import { PlayerTrail } from '../player-trail.js';
import { doorGroups, barrierGroups, movingEntityIds, boxLocations } from '../shangri-la-rules.js';

/**
 * Generic solo-survival map runtime. A map is one config object (see maps/index.js for the
 * registry and maps/shangri-la.js for an example); everything else - renderer, lights, player,
 * doors, barricades, box, perks, enemies, HUD, loop - is shared here.
 */
export function createSurvivalMap(cfg) {
const C = withDefaults(cfg);
return { mount: ctx => mountSurvival(ctx, C) };
}

export function withDefaults(cfg) {
  const base = cfg.base.replace(/\/$/, '');
  const L = { background: 0xa4bbbf, ambient: [0xc3d6e8, .9], hemi: [0xbfd8ec, 0x756342, 2.0], sun: [0xf7ba7f, 2.5, [-.75, .65, .15]], fill: [0xa2bbc5, .55, [.5, .3, -.7]], exposure: 1.35, ...cfg.lighting };
  return {
    fov: 78, far: 70000, cellSize: 640, verticalCellSize: 384, ...cfg,
    base, mapData: cfg.mapData ?? `${base}/map-data.json`, gltf: cfg.gltf ?? `${base}/${cfg.id}.gltf`,
    collisionMeta: cfg.collisionMeta ?? `${base}/collision.json`, pack: cfg.pack ?? `asset-pack/${cfg.id}.pack`,
    lighting: L,
    player: { radius: 15, height: 70, eyeHeight: 60, moveSpeed: 190, sprintSpeed: 285, crouchSpeed: 90, gravity: 800, jumpHeight: 39, stepHeight: 18, groundProbeDistance: 4, ...cfg.player },
    classes: { session: ShangriSession, enemies: ShangriEnemies, features: ShangriFeatures, navigation: SurvivalNavigation, ...cfg.classes },
    startHint: cfg.startHint ?? '500 points. M1911. Buy a door, throw both power switches and survive.',
    controls: cfg.controls ?? 'WASD · Move   Mouse · Fire / Aim   Shift · Sprint\nSpace · Jump   Ctrl / C · Crouch   F / E · Interact (hold to repair)\nR · Reload   V · Knife   G · Grenade   1 / 2 / 3 · Weapon\nM · Sound   Esc · Pause   F3 · Diagnostics',
  };
}

async function mountSurvival(ctx, C) {
const LOG = '[' + C.id + ']';
const addEventListener = (type, handler, options) => ctx.listen(window, type, handler, options);
let disposed = false;
const $ = id => document.getElementById(id), keys = new Set(), errors = [];
const vector = a => new THREE.Vector3(...a);
const coarse = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: !coarse, powerPreference: coarse ? 'default' : 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = C.lighting.exposure;
renderer.autoClear = false;
renderer.domElement.setAttribute('aria-label', C.label+' map');
ctx.attach(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.lighting.background);
const camera = new THREE.PerspectiveCamera(C.fov, innerWidth / innerHeight, 1, C.far);
camera.rotation.order = 'YXZ';
const gfx = bindExploreGraphics({ ctx, renderer, camera, maxPixelRatio: Math.min(devicePixelRatio, coarse ? 1 : 1.5), baseFar: C.far, targetMs: coarse ? 1000 / 30 : 1000 / 60 });
const LT = C.lighting;
scene.add(new THREE.AmbientLight(...LT.ambient), new THREE.HemisphereLight(...LT.hemi));
const sun = new THREE.DirectionalLight(LT.sun[0], LT.sun[1]);
sun.position.set(...LT.sun[2]);
const fill = new THREE.DirectionalLight(LT.fill[0], LT.fill[1]);
fill.position.set(...LT.fill[2]);
scene.add(sun, fill);

let data, player, collision, navigation, combat, features, groups = [], ready = false, active = false, lastPoints = null, perkKey = '';
let notice = '', noticeLeft = 0, debugVisible = false, frames = 0, frameTime = 0, fps = 0, target = null;
const trail = new PlayerTrail();
const objects = new Map(), parts = new Map(), boughtGuns = new Set(), wallGuns = new Map();
const chalk = new ChalkHud();
let mousePrimary = false, mouseSecondary = false, mouseAim = false, touchFirePending = false;

function showNotice(text, duration = 4) { notice = text; noticeLeft = duration; }
// One bad frame must not freeze the whole game: log it once, surface it in the diagnostics (F3) and keep rendering.
const faults = new Map();
function reportFault(error) {
  const key = String(error?.message ?? error);
  const n = (faults.get(key) ?? 0) + 1;
  faults.set(key, n);
  if (n === 1) { console.error(LOG, error); errors.push(key); showNotice('Game error: ' + key.slice(0, 80), 6); }
}

const touchControls = createZombieTouch({
  ctx,
  minimal: true, menuSettings: false,
  onReset: () => { touchFirePending = false; },
  onLook: (x, y, sensitivity) => {
    if (!active || combat.session.phase === 'reviving') return;
    const scale = .005 * sensitivity * (combat.ads ? .5 : 1);
    camera.rotation.y -= x * scale;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - y * scale, -1.5, 1.5);
  },
  onAction: action => {
    if (!active || combat.session.phase === 'reviving') return;
    const code = { reload: 'KeyR', melee: 'KeyV', grenade: 'KeyG' }[action];
    if (code) combat.key(code);
    if (action === 'weapon') combat.switchWeapon();
    if (action === 'use') interact();
  },
  onPause: () => ctx.pause(),
});

function pause() {
  active = false;
  keys.clear();
  mousePrimary = mouseSecondary = mouseAim = touchFirePending = false;
  touchControls.reset();
  touchControls.setEnabled(false);
  player?.setEnabled(false);
  combat?.pause();
  $('hurt').style.opacity = 0;
}
function resume() {
  if (!ready || combat.session.phase === 'gameover') return;
  touchControls.reset();
  touchControls.setEnabled(true);
  active = true;
  player.setEnabled(true);
  combat.resume();
}
function setActive(value) { if (value) resume(); else pause(); }

function endRun() {
  const s = combat.session;
  ctx.gameOver({ status: `Game over · ${s.kills} kills · Round ${s.round} · ${Math.floor(s.time)} seconds` });
}

function spawnPlayer() {
  player.setPosition(vector(data.spawn.position).add(new THREE.Vector3(0, 3, 0)));
  camera.rotation.set(0, data.spawn.yaw - Math.PI / 2, 0);
}

function syncWallGuns() { for (const [id, list] of wallGuns) for (const o of list) o.visible = boughtGuns.has(id); }

function makePart(entity, object, extra = {}) {
  if (!object) return null;
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return makeBoxPart(entity, object, box, extra);
}
function makeBoxPart(entity, object, box, extra = {}) {
  const size = box.getSize(new THREE.Vector3());
  if (Math.min(size.x, size.y, size.z) < .01) return null;
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.translate(...box.getCenter(new THREE.Vector3()).toArray());
  geometry.computeBoundingBox();
  return { entity, object, box, origin: object?.position.clone(), amount: 0, open: false, opening: false, collider: new CollisionWorld(geometry), ...extra };
}
function closedBoxes() { return [...parts.values()].filter(p => p.door && !p.open).map(p => p.box); }
function syncNavigation() { navigation.setBlockers(closedBoxes()); }

function capsuleIntersect(capsule) {
  const hit = collision.capsuleIntersect(capsule);
  if (hit) return hit;
  for (const part of parts.values()) {
    if (part.open) continue;
    const contact = part.collider.capsuleIntersect(capsule);
    if (contact) return contact;
  }
  if (combat?.enabled) for (const z of combat.enemies.list) {
    const p = z.root.position, feet = capsule.start.y - capsule.radius, top = capsule.end.y + capsule.radius;
    if (feet > p.y + 65 || top < p.y + 4) continue;
    const normal = new THREE.Vector3(capsule.start.x - p.x, 0, capsule.start.z - p.z), distance = normal.length(), depth = capsule.radius + 15 - distance;
    if (depth > 0) return { normal: distance > .001 ? normal.divideScalar(distance) : new THREE.Vector3(1, 0, 0), depth };
  }
  return false;
}
function rayIntersect(ray, near = 0, far = Infinity) {
  let hit = collision.rayIntersect(ray, near, far);
  for (const part of parts.values()) {
    if (part.window || part.open) continue;
    const contact = part.collider.rayIntersect(ray, near, hit ? Math.min(hit.distance, far) : far);
    if (contact) hit = contact;
  }
  return hit;
}

function openDoor(group) {
  for (const part of parts.values()) if (part.door === group.name) { part.open = true; part.opening = true; }
  syncNavigation();
}
function updateDoors(dt) {
  for (const part of parts.values()) {
    if (!part.opening || !part.object) continue;
    part.amount = Math.min(1, part.amount + dt / 1.2);
    part.object.position.copy(part.origin).y -= part.amount * 150;
    if (part.amount >= 1) { part.opening = false; part.object.visible = false; }
  }
}

function interact() {
  features.findTarget();
  if (!features.target || !combat.session.canAct && !(features.target.kind === 'pack' && combat.session.pack)) return false;
  return features.interact(features.target);
}
function promptText() {
  const t = features.findTarget();
  target = t;
  if (!t) return '';
  const label = t.label.startsWith('Hold F') ? t.label : 'F · ' + t.label;
  return touchControls.mode ? label.replace(/\bF\s*·/g, 'USE ·').replace('Hold F', 'Hold USE') : label;
}

function update(dt) {
  touchControls.setEnabled(active && !['reviving', 'gameover'].includes(combat.session.phase), active);
  const touch = touchControls.input.read();
  if (!touchControls.enabled) touchFirePending = false;
  touchFirePending ||= touch.firePressed;
  const touchWantsFire = touch.fire || touchFirePending;
  combat.primary = mousePrimary || touchWantsFire;
  if (touchFirePending && combat.view.ready && !['raise', 'melee', 'sprintIn', 'sprint', 'sprintOut'].includes(combat.view.mode)) {
    combat.pressed = true;
    touchFirePending = false;
  }
  const secondary = mouseSecondary || (combat.session.def.dualWield && touch.aim);
  combat.secondaryPressed ||= secondary && !combat.secondary;
  combat.secondary = secondary;
  combat.ads = mouseAim || (touch.aim && !combat.session.def.dualWield);
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touch.forward;
  const strafe = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.strafe;
  const moving = Math.hypot(forward, strafe) > .01;
  const sprint = ((keys.has('ShiftLeft') || keys.has('ShiftRight')) && keys.has('KeyW') || touch.sprint) && !touchWantsFire && !combat.ads && !combat.session.reloadLeft && !combat.session.meleeLeft;
  const fast = combat.session.perks.has('specialty_longersprint');
  player.moveSpeed = fast ? 209 : 190;
  player.sprintSpeed = fast ? 330 : 285;
  // Each subsystem is isolated: a failure in one is reported once and must not stop the others (or the render).
  const safely = fn => { try { fn(); } catch (error) { reportFault(error); } };
  if (combat.session.phase !== 'reviving') safely(() => player.update(dt, { forward, strafe, sprint, jump: keys.has('Space'), jumpPressed: touch.jump, crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC') || touch.crouch }));
  safely(() => { if (player.getFeetPosition().y < collision.metadata.bounds.min[1] - 600) spawnPlayer(); });
  safely(() => trail.record(player.getFeetPosition()));
  safely(() => updateDoors(dt));
  safely(() => combat.update(dt, { moving, sprint }));
  safely(() => features.update(dt, keys.has('KeyF') || keys.has('KeyE') || touch.use));
  noticeLeft = Math.max(0, noticeLeft - dt);
  $('toast').textContent = noticeLeft ? notice : '';
  $('prompt').textContent = promptText();
  hud();
}

function hud() {
  const s = combat.session, w = s.weapon;
  $('hurt').style.opacity = active ? (1 - s.health / s.maxHealth) * .8 : 0;
  chalk.update(s, true);
  if (lastPoints === null || s.points === 0 && lastPoints > 0 && s.phase === 'gameover') lastPoints = s.points;
  if (s.points !== lastPoints) { spawnScorePopup($('score-popups'), s.points - lastPoints); lastPoints = s.points; }
  $('points').textContent = s.points;
  $('mag').textContent = w.mag;
  $('reserve').textContent = w.reserve;
  const cap = s.def.magSize || s.def.clipSize || s.def.clip || s.def.ammoClip || s.def.mag || 8;
  $('mag').classList.toggle('low', w.mag <= Math.floor(cap / 3));
  renderAmmoIcons($('ammo-icons'), s.def, w.mag);
  $('weapon-name').textContent = s.def.name;
  $('grenade-count').textContent = s.grenades;
  $('reload-label').textContent = s.reloadLeft <= 0 && w.mag === 0 && w.reserve > 0 ? (touchControls.mode ? 'Tap reload' : 'Reload') : '';
  $('weapon-status').textContent = s.phase === 'reviving' ? 'QUICK REVIVE…' : s.pack ? 'WEAPON IN PACK-A-PUNCH' : '';
  $('hitmarker').style.opacity = combat.hitUntil > s.time ? 1 : 0;
  $('power').textContent = s.power ? 'POWER ON' : 'POWER OFF';
  const seconds = performance.now() / 1000;
  for (const key of ['double_points', 'insta_kill', 'fire_sale']) {
    const slot = $('pu-' + key), left = (s.effects[key] ?? 0) - s.time, visible = left > 0 && powerupVisible(left, seconds);
    if (slot && slot.hidden === visible) slot.hidden = !visible;
  }
  const key = [...s.perks].join();
  if (key !== perkKey) {
    perkKey = key;
    $('perks').innerHTML = [...s.perks].map(id => MOON_PERKS[id].image
      ? `<img alt="${MOON_PERKS[id].name}" title="${MOON_PERKS[id].name}" src="textures/${MOON_PERKS[id].image}.png">`
      : `<span title="${MOON_PERKS[id].name}" style="background:${MOON_PERKS[id].color}">${MOON_PERKS[id].icon}</span>`).join('');
  }
}

async function resetRun() {
  if (!ready) return;
  pause();
  ready = false;
  boughtGuns.clear();
  syncWallGuns();
  chalk.reset();
  lastPoints = null;
  perkKey = '';
  for (const part of parts.values()) {
    part.open = part.opening = false;
    part.amount = 0;
    if (part.object) { part.object.position.copy(part.origin); part.object.visible = true; }
  }
  syncNavigation();
  trail.reset();
  await combat.reset();
  features.reset();
  spawnPlayer();
  ready = true;
  ctx.setHint(C.startHint);
}

addEventListener('mousemove', e => {
  if (active && document.pointerLockElement === renderer.domElement) {
    const sensitivity = combat?.ads ? .0012 : .002;
    camera.rotation.y -= e.movementX * sensitivity;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - e.movementY * sensitivity, -1.5, 1.5);
  }
});
addEventListener('mousedown', e => {
  if (!active || e.sourceCapabilities?.firesTouchEvents || e.target.closest('#touch-controls')) return;
  if (e.button === 0) { mousePrimary = combat.primary = true; combat.pressed = true; }
  if (e.button === 2) {
    if (combat.session.def.dualWield) { mouseSecondary = combat.secondary = true; combat.secondaryPressed = true; } else mouseAim = combat.ads = true;
  }
});
addEventListener('mouseup', e => {
  if (!combat || e.sourceCapabilities?.firesTouchEvents) return;
  if (e.button === 0) mousePrimary = combat.primary = false;
  if (e.button === 2) { mouseAim = combat.ads = false; mouseSecondary = combat.secondary = false; }
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', () => { if (active) combat.switchWeapon(); });
addEventListener('keydown', e => {
  if (['Space', 'F3', 'Tab'].includes(e.code)) e.preventDefault();
  if (!active) return;
  keys.add(e.code);
  if (e.repeat) return;
  combat.key(e.code);
  if (['KeyF', 'KeyE'].includes(e.code)) interact();
  if (e.code === 'F3') { debugVisible = !debugVisible; $('debug').hidden = !debugVisible; }
  if (e.code === 'Escape') ctx.pause();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (combat) { combat.viewCamera.aspect = camera.aspect; combat.viewCamera.updateProjectionMatrix(); }
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('error', e => errors.push(e.message));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
ctx.onDispose(() => {
  disposed = true;
  renderer.setAnimationLoop(null);
  try { touchControls.destroy(); } catch {}
  try { combat?.audio.dispose(); } catch {}
  try { combat?.clearTransient(); combat?.enemies.reset(); combat?.pickups.reset(); } catch {}
  try { navigation?.dispose(); } catch {}
  for (const root of [scene, combat?.viewScene]) if (root) { try { disposeObject(root); } catch (error) { console.warn(error); } }
  objects.clear();
  parts.clear();
  wallGuns.clear();
});

function prepareMaterials(root) {
  const prepared = new Set(), hiddenEntities = new Set(data.hiddenEntities);
  root.traverse(object => {
    if (object.userData.collisionOnly || hiddenEntities.has(object.userData.entityId)) object.visible = false;
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (prepared.has(material)) continue;
      prepared.add(material);
      const source = material.userData.sourceMaterialNames?.[0] || material.name;
      const base = source.startsWith('*') ? (source.match(/\(([^:)]+)/)?.[1] ?? source) : source.replace(/^[^:]+:(?=[mw]c\/)/, '');
      const rule = data.materialRules[base];
      if (rule?.hidden || /sky|shadowcaster|hdrportal|caulk|portal_nodraw|clip_player|lightshaft|mtl_player_icon|mtl_clan_tag/i.test(base)) material.visible = false;
      if (rule?.water) {
        material.color.setRGB(...rule.color.slice(0, 3));
        material.transparent = true;
        material.opacity = Math.min(.88, rule.color[3]);
        material.depthWrite = false;
        material.roughness = .22;
        material.envMap = scene.background;
        material.envMapIntensity = .55;
      }
      if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
  });
}

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
async function load() {
  const response = await fetch(C.mapData);
  if (!response.ok) throw new Error(`Map data failed to load (${response.status})`);
  data = await response.json();
  let steps = 0;
  const showStatus = text => ctx.progress(text, Math.min(.92, .04 + (++steps) * .025));
  const manager = new THREE.LoadingManager();
  manager.onError = url => errors.push(`Asset failed: ${url}`);
  showStatus(`Loading ${C.label}…`);
  const sharedAssets = preloadShared();
  const gltf = await loadMapGltf(C.gltf, { label: C.label, onStatus: showStatus, pack: C.pack });
  const textureReport = await settleTextures({ onStatus: showStatus });
  showStatus(`Loading ${C.label} collision and sky…`);
  const [collider, sky] = await Promise.all([
    loadCollisionWorld({ metadataUrl: C.collisionMeta, onProgress: ({ loaded, total }) => showStatus(`Loading ${C.label} collision… ${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`) }),
    new THREE.CubeTextureLoader(manager).loadAsync(data.sky.faces.map(face => C.base + '/' + face)),
  ]);
  if (errors.length) throw new Error(errors.join('\n'));
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  scene.backgroundRotation.x = -Math.PI / 2;
  collision = collider;
  const missingTextures = textureWarning(textureReport);
  if (missingTextures) { errors.push(missingTextures); console.warn(missingTextures); }
  showStatus(`Preparing ${C.label} scene…`);
  await nextTask();
  prepareMaterials(gltf.scene);
  applyChalkTransparency(gltf.scene);
  scene.add(gltf.scene);
  scene.updateMatrixWorld(true);

  groups = doorGroups(data.entities);
  const barriers = barrierGroups(data.entities);
  const dynamic = new Set(movingEntityIds(data.entities));
  for (const e of boxLocations(data.entities)) for (const suffix of ['_box', '_lid']) {
    const entity = data.entities.find(n => n.targetname === e.script_noteworthy + suffix);
    if (entity) dynamic.add(entity.id);
  }
  const gunModels = new Map();
  for (const t of data.entities) {
    if (t.targetname !== 'weapon_upgrade' || !t.target) continue;
    const model = data.entities.find(n => n.classname === 'script_model' && n.targetname === t.target);
    if (model) { dynamic.add(model.id); gunModels.set(t.id, model.id); }
  }
  const detach = [];
  gltf.scene.traverse(o => { if (o.userData.entityId !== undefined && dynamic.has(o.userData.entityId)) detach.push(o); });
  for (const o of detach) { scene.attach(o); o.matrixAutoUpdate = true; objects.set(o.userData.entityId, o); }

  for (const group of groups) for (const id of group.parts) {
    const part = makePart(data.entities[id], objects.get(id), { door: group.name });
    if (part) parts.set(id, part);
  }
  for (const b of barriers) {
    const boxes = b.boards.map(id => objects.get(id)).filter(Boolean).map(o => new THREE.Box3().setFromObject(o));
    if (!boxes.length) continue;
    const box = boxes.reduce((a, c) => a.union(c), new THREE.Box3());
    const part = makeBoxPart(data.entities[b.id], null, box, { window: true });
    if (part) parts.set('window-' + b.id, part);
  }
  showStatus(`Optimizing ${C.label}…`);
  await nextTask();
  const optimization = optimizeStaticScene(gltf.scene, { cellSize: C.cellSize, verticalCellSize: C.verticalCellSize });
  showStatus(`Loading ${C.label} navigation…`);
  await nextTask();
  navigation = new C.classes.navigation(C.base);
  await navigation.load();
  syncNavigation();

  player = new PlayerController(camera, { capsuleIntersect, rayIntersect }, { ...C.player });
  showStatus('Loading zombies and weapons…');
  await sharedAssets;
  const worldApi = {
    navigation,
    path: (a, b) => navigation.path(a, b),
    closest: (p, e) => navigation.closest(p, e),
    raycast: rayIntersect,
    lineClear: (a, b) => { const d = b.clone().sub(a); return !rayIntersect(new THREE.Ray(a, d.clone().normalize()), 1, Math.max(1, d.length() - 4)); },
    lowGravity: () => false,
    zoneAt: () => C.id,
    spawnBarriers: () => features.barriers,
    stepClear: (a, b) => navigation.stepClear(a, b),
  };
  combat = new MoonCombat(scene, camera, worldApi, { notice: showNotice, end: endRun, feet: () => player.getFeetPosition(), sessionClass: C.classes.session, enemiesClass: C.classes.enemies });
  await combat.load();
  showStatus('Preparing perks, box and barricades…');
  features = new C.classes.features({ data, combat, scene, camera, objects, notice: showNotice, raycast: rayIntersect, doors: groups, openDoor });
  await features.load();
  worldApi.setBoards = (b, n) => features.setBoards(b, n);
  combat.enemies.barriers = features.barriers;
  combat.enemies.trail = trail;
  combat.enemies.candidates = navigation.metadata.candidates.map(c => ({ ...c, point: vector(c.position) }));
  // Preflight: verify (and if needed automatically map) the routes now, while the map is loading, so a bad navmesh
  // is handled here instead of by the first zombie of round 1.
  navigation.attach({ raycast: rayIntersect }, { start: vector(navigation.metadata.start ?? data.spawn.position), barriers: features.barriers, candidates: combat.enemies.candidates });
  showStatus('Checking zombie routes…');
  await navigation.prepare({ onStatus: showStatus });
  if (navigation.health && !navigation.health.reachable) showNotice('No verified zombie route found. Using fallback movement.', 8);
  combat.enemies.onDrop = (type, position) => { if (combat.data.powerups[type]) combat.pickups.spawn(type, position); };
  for (const [triggerId, modelId] of gunModels) { const o = objects.get(modelId); if (o) wallGuns.set(triggerId, [o]); }
  const buy = features.interact.bind(features);
  features.interact = t => {
    const ok = buy(t);
    if (ok && t?.kind === 'wall') { boughtGuns.add(t.e.id); syncWallGuns(); }
    return ok;
  };
  syncWallGuns();
  features.setAllBoards();
  spawnPlayer();
  for (let i = 0; i < 90; i++) player.update(1 / 120, {});
  showStatus('Preparing graphics…');
  await nextTask();
  try { await Promise.race([Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(combat.viewScene, combat.viewCamera)]), new Promise(resolve => setTimeout(resolve, 20000))]); } catch (error) { console.warn(LOG + ' shader precompile skipped', error); }
  player.enabled = false;
  ready = true;
  $('mode-label').textContent = (C.modeLabel ?? C.label.toUpperCase() + ' / SOLO SURVIVAL');
  $('location').textContent = C.label;
  ctx.hud.hidden('systems', false);
  ctx.hud.combat(true);
  ctx.hud.crosshair(true);
  ctx.setControls(C.controls);
  ctx.setHint(C.startHint);
  ctx.expose(C.expose ?? C.id.replace(/-(\w)/g, (_, c) => c.toUpperCase()), {
    ready: true, data, player, camera, scene, renderer, collision, parts, errors, optimization, combat, navigation, features,
    debug: {
      interact, update, resetRun, pause, resume, target: () => target, navigation: () => navigation.health,
      snapshot: () => ({ position: player.getFeetPosition().toArray(), grounded: player.isGrounded, active, power: combat.session.power, doors: [...combat.session.openDoors], combat: combat.snapshot(), fps, errors: [...errors] }),
    },
  });
}

await load();
let previous = performance.now();
renderer.setAnimationLoop(now => {
  if (disposed) return;
  const dt = Math.max(0, (now - previous) / 1000);
  previous = now;
  if (ready && active) gfx.sample(dt * 1000);
  for (let remaining = Math.min(.25, dt); active && remaining > 0;) {
    const step = Math.min(.05, remaining);
    try { update(step); } catch (error) { reportFault(error); break; }
    remaining -= step;
  }
  if (!ready) { previous = now; return; }
  renderer.clear();
  renderer.render(scene, camera);
  if (active) { renderer.clearDepth(); renderer.render(combat.viewScene, combat.viewCamera); }
  frames++;
  frameTime += dt;
  if (frameTime >= .5) { fps = Math.round(frames / frameTime); frames = 0; frameTime = 0; }
  if (debugVisible) $('debug').textContent = `${fps} FPS · ${renderer.info.render.calls} calls\n${player.getFeetPosition().toArray().map(n => n.toFixed(1)).join(', ')}\n${combat.session.openDoors.size}/${groups.length} doors open`;
});
return { setActive, restart: () => resetRun() };
}

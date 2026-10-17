import * as THREE from 'three';
import { loadMapGltf } from '../map-assets.js';
import { ensureTextures } from '../load-flow.js';
import { PlayerController } from '../player-controller.js';
import { loadCollisionWorld } from '../collision-world.js';
import { optimizeStaticScene } from '../scene-optimizer.js';
import { disposeObject } from '../dispose.js';
import { applyChalkTransparency } from '../chalk-transparency.js';
import { createWallGuns } from '../wall-guns.js';
import { bindExploreGraphics } from '../explore-graphics.js';
import { GamepadInput, padSettings } from '../gamepad.js';

export async function mount(ctx) {
const addEventListener = (type, handler, options) => ctx.listen(window, type, handler, options);
let disposed = false;
const CONTROLS = 'WASD · Move   Mouse · Look   Shift · Sprint\nSpace · Jump   Ctrl · Crouch   V · Fly or walk\nR · Return to spawn   Esc · Pause';

const status = document.querySelector('#status'), help = document.querySelector('#help');
const keys = new Set(), errors = [];
const PAD_CONTROLS = 'Left stick · Move   L3 · Sprint / fly faster   Right stick · Look\nA · Jump / ascend   B · Crouch / descend\nR3 · Fly or walk   X · Use wall gun\nBack · Return to spawn   Start · Pause';
const pad = new GamepadInput({
  onLook: (x, y) => {
    if (!active) return;
    camera.rotation.y -= x * .005 * padSettings.sensitivity;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - y * .005 * padSettings.sensitivity, -1.55, 1.55);
  },
  onAction: action => {
    if (!active) return;
    if (action === 'melee') toggleFlight();
    if (action === 'usereload') wallGuns?.interact();
    if (action === 'journal') relocate();
  },
  onPause: () => ctx.pause(),
});
pad.attach(window);
ctx.onDispose(() => pad.detach());
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(78, innerWidth/innerHeight, 1, 70000);
camera.rotation.order = 'YXZ';
scene.background = new THREE.Color(0x23313d);
scene.fog = new THREE.FogExp2(0x23313d, .000105);
// As in Kino, lighting is reconstructed over the original albedo textures.
scene.add(new THREE.AmbientLight(0xb5c4d5, 1.15), new THREE.HemisphereLight(0xbdcdda, 0x46535e, 1.65));
const sun = new THREE.DirectionalLight(0xc2cbce, 2.1);
sun.position.set(-.862899, .430586, -.264579); scene.add(sun);
const fill = new THREE.DirectionalLight(0x91a8bf, .65); fill.position.set(.6, .5, .8); scene.add(fill);
let renderer, data, player, collision, gfx, wallGuns, waterNormal, ready = false, active = false, flying = false, optimization;
let previous = performance.now(), helpUntil = 0, resetCount = 0;
const wish = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
const query = new URLSearchParams(location.search);
const debug = query.has('debug');
ctx.onDispose(() => {
  disposed = true; renderer?.setAnimationLoop(null);
  try { scene.background?.dispose?.(); waterNormal?.dispose?.(); } catch {}
  try { disposeObject(scene); } catch (error) { console.warn(error); }
});
function fail(reason) {
  const message = String(reason?.message || reason);
  errors.push(message); ready = false; release();
  ctx.fail(`Unable to load Call of the Dead: ${message}`);
}
function showHelp() {
  help.textContent = `${active ? '' : 'Click the map to look around · '}WASD move · Shift ${flying ? 'fast' : 'sprint'} · Space ${flying ? 'up' : 'jump'} · Ctrl ${flying ? 'down' : 'crouch'} · V ${flying ? 'walk' : 'fly'} · R return · Esc release`;
  helpUntil = performance.now() + 6500; help.classList.remove('quiet');
}
function release() {
  active = false; keys.clear(); player?.setInput({}); player?.setEnabled(false); showHelp();
}
function relocate(name = 'spawn') {
  const landmark = data.landmarks[name];
  if (!landmark) throw new Error(`Unknown coast location ${name}`);
  flying = false;
  player.setPosition(new THREE.Vector3(...landmark.position).add(new THREE.Vector3(0, 3, 0)));
  camera.rotation.set(0, landmark.yaw - Math.PI/2, 0);
  player.setEnabled(active); showHelp();
}
function toggleFlight() {
  flying = !flying;
  if (flying) player.setEnabled(false);
  else {
    player.setPosition(camera.position.clone().add(new THREE.Vector3(0, -player.eyeHeight, 0)));
    player.setEnabled(active);
  }
  keys.clear(); showHelp();
}
async function load() {
  renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
  renderer.domElement.setAttribute('aria-label', 'Call of the Dead map');
  renderer.domElement.tabIndex = 0; ctx.attach(renderer);
  gfx = bindExploreGraphics({ctx, renderer, camera, maxPixelRatio: Math.min(devicePixelRatio, 1.5), baseFar: 70000});
  renderer.domElement.addEventListener('webglcontextlost', event => {event.preventDefault(); fail('Graphics context was lost');});
  const response = await fetch('coast/map-data.json');
  if (!response.ok) throw new Error(`Map metadata HTTP ${response.status}`);
  data = await response.json();
  let steps = 0;
  const showStatus = text => ctx.progress(text, Math.min(.92, .05 + (++steps) * .03));
  const manager = new THREE.LoadingManager();
  manager.onError = url => errors.push(`Asset failed: ${url}`);
  showStatus('Loading Call of the Dead…');
  const gltf = await loadMapGltf('coast/coast.gltf', {label: 'Call of the Dead', onStatus: showStatus, pack: 'asset-pack/coast.pack'});
  await ensureTextures(ctx);
  showStatus('Loading Call of the Dead collision and sky…');
  const [physics, sky, waves] = await Promise.all([
    loadCollisionWorld({metadataUrl: 'coast/collision.json', onProgress: ({loaded, total}) => showStatus(`Loading Call of the Dead collision… ${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`)}),
    new THREE.CubeTextureLoader(manager).setPath('coast/').loadAsync(data.sky),
    new THREE.TextureLoader(manager).loadAsync('coast/textures/ocean_waves_bump.png'),
  ]);
  if (errors.length) throw new Error(errors.join('; '));
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  // The native DDS is in game coordinates. Rotate it into the same y-up
  // basis as the geometry, including the source sky material's 30° rotation.
  scene.backgroundRotation.set(-Math.PI/2, 0, Math.PI/6);
  scene.backgroundIntensity = .8;
  waterNormal = waves;
  waves.wrapS = waves.wrapT = THREE.RepeatWrapping;
  const waterMaterial = new THREE.MeshStandardMaterial({name: 'coast_ocean',
    color: new THREE.Color(...data.water.color), normalMap: waves, normalScale: new THREE.Vector2(.6,.6),
    metalness: .35, roughness: .24, envMap: sky, envMapIntensity: .8, side: THREE.DoubleSide});
  collision = physics;
  gltf.scene.traverse(object => {
    if (object.userData.collisionOnly || object.userData.explorationHidden) object.visible = false;
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const name = material.userData.sourceMaterialNames?.[0] || material.name;
      if (name.includes('zom_ocean_water_dynamic')) {
        object.material = waterMaterial;
        // Native water uses world-space planar projection, not the source UVs.
        object.geometry = object.geometry.clone();
        const positions = object.geometry.attributes.position;
        const uv = new Float32Array(positions.count*2);
        for (let i=0; i<positions.count; i++) {uv[i*2]=positions.getX(i)*data.water.uvScale[0]; uv[i*2+1]=-positions.getZ(i)*data.water.uvScale[1];}
        object.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        continue;
      }
      if (/\bsky_night\b|mtl_skybox|shadowcaster|hdrportal|caulk|portal_nodraw|clip_player/i.test(name)) object.visible = false;
      if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (/mtl_glass|glass_v2/i.test(name)) {
        material.transparent = true; material.opacity = .28; material.depthWrite = false;
      }
    }
  });
  applyChalkTransparency(gltf.scene);
  wallGuns = createWallGuns({entities: data.entities, root: gltf.scene, camera, promptElement: document.getElementById('prompt')});
  optimization = optimizeStaticScene(gltf.scene, {cellSize: 768, verticalCellSize: 256});
  scene.add(gltf.scene);
  player = new PlayerController(camera, collision, {radius: 14, height: 70, eyeHeight: 60,
    moveSpeed: 190, sprintSpeed: 285, crouchSpeed: 95, gravity: 800, jumpHeight: 39,
    stepHeight: 18, maxSubSteps: 12, groundProbeDistance: 4, groundSnapSpeed: 10});
  relocate();
  // Settle at the original spawn before requesting mouse input.
  player.setEnabled(true); for (let i = 0; i < 120; i++) player.update(1/120, {}); player.setEnabled(false);
  ready = true;
  if (debug && query.has('landmark')) relocate(query.get('landmark'));
  ctx.setControls(CONTROLS);
  ctx.setPadControls(PAD_CONTROLS);
  ctx.setHint('Click to capture the mouse · Esc to pause');
  renderer.setAnimationLoop(frame);
}
function frame(now) {
  if (disposed) return;
  const dt = Math.min((now-previous)/1000, .05); previous = now;
  // Read every frame, even while paused, so a held button never looks like a fresh press on resume.
  pad.setEnabled(ready && active);
  const p = pad.read();
  if (ready && active) {
    const clamp = value => Math.max(-1, Math.min(1, value));
    const walk = clamp(Number(keys.has('KeyW'))-Number(keys.has('KeyS'))+p.forward), strafe = clamp(Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+p.strafe);
    if (flying) {
      camera.getWorldDirection(forward); right.set(1,0,0).applyQuaternion(camera.quaternion);
      wish.set(0,0,0).addScaledVector(forward, walk).addScaledVector(right, strafe);
      wish.y += Number(keys.has('Space') || p.jumpHeld)-Number(keys.has('ControlLeft') || keys.has('ControlRight') || p.crouchHeld);
      if (wish.lengthSq()) camera.position.addScaledVector(wish.normalize(), dt*(keys.has('ShiftLeft') || keys.has('ShiftRight') || p.sprint ? 1800 : 600));
    } else {
      // The controller's fields are explicit and already include the keyboard's contribution. The
      // controller reads the first field it finds for each input, so the opposite directions are
      // zeroed (otherwise a held KeyA/KeyS would be subtracted a second time) and jump is spelled out
      // (a defined jumpPressed would otherwise hide Space).
      player.update(dt, {...Object.fromEntries([...keys].map(key => [key, true])), forward: walk, strafe, backward: 0, moveLeft: 0,
        sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || p.sprint,
        crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC') || p.crouch,
        jump: keys.has('Space'), jumpPressed: p.jump});
      if (player.feetPosition.y < -500) {resetCount++; relocate();}
    }
  }
  help.classList.toggle('quiet', active && now > helpUntil);
  if (waterNormal && active) {waterNormal.offset.x += dt*data.water.scroll[0]; waterNormal.offset.y += dt*data.water.scroll[1];}
  if (ready && active) { gfx.sample(dt*1000); wallGuns.update(); }
  renderer.render(scene, camera);
}
function setActive(value) {
  if (!value) { release(); return; }
  active = true; keys.clear(); player?.setEnabled(!flying); showHelp();
}
addEventListener('mousemove', event => {
  if (!active) return;
  camera.rotation.y -= event.movementX*.002;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x-event.movementY*.002, -1.55, 1.55);
});
addEventListener('keydown', event => {
  if (!active) return;
  if (['Space','ControlLeft','ControlRight','KeyV','KeyR'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'Escape') {ctx.pause(); return;}
  if (event.code === 'KeyV') toggleFlight();
  if (event.code === 'KeyE') wallGuns?.interact();
  if (event.code === 'KeyR') relocate();
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer?.setSize(innerWidth, innerHeight);
});
// Developer inspection is opt-in; the normal page is only the map.
if (debug) ctx.expose('coast', {
  get ready() {return ready;}, get data() {return data;}, get player() {return player;}, camera, scene,
  relocate, snapshot: () => ({ready, active, flying, position: camera.position.toArray(),
    feet: player?.feetPosition.toArray(), grounded: player?.isGrounded, crouched: player?.crouched,
    errors: [...errors], collision: collision?.stats, optimization, resetCount,
    calls: renderer?.info.render.calls, triangles: renderer?.info.render.triangles}),
});
try { await load(); } catch (error) { fail(error); throw error; }
return { setActive };
}

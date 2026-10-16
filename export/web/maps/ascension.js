import * as THREE from 'three';
import { loadMapGltf, settleTextures, textureWarning } from '../map-assets.js';
import { loadCollisionWorld } from '../collision-world.js';
import { PlayerController } from '../player-controller.js';
import { optimizeStaticScene } from '../scene-optimizer.js';
import { disposeObject } from '../dispose.js';
import { applyChalkTransparency } from '../chalk-transparency.js';
import { createWallGuns } from '../wall-guns.js';
import { bindExploreGraphics } from '../explore-graphics.js';

export async function mount(ctx) {
const addEventListener = (type, handler, options) => ctx.listen(window, type, handler, options);
let disposed = false;
const CONTROLS = 'WASD · Move   Mouse · Look   Shift · Sprint / fly faster\nSpace · Jump / ascend   Ctrl · Crouch / descend\nF · Fly or walk   R · Return to spawn   H · Hide help\nF3 · Diagnostics   Esc · Pause';

const status = document.getElementById('status');
const help = document.getElementById('help');
const debug = document.getElementById('debug');
const keys = new Set(), errors = [];
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 1, 70000);
camera.rotation.order = 'YXZ';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x212c39);
let renderer, data, player, collision, world, optimization, gfx, wallGuns;
let ready = false, active = false, flying = false, helpVisible = true, fps = 0;
const forward = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
ctx.onDispose(() => {
  disposed = true; renderer?.setAnimationLoop(null);
  try { scene.background?.dispose?.(); } catch {}
  try { disposeObject(scene); } catch (error) { console.warn(error); }
});


function updateHelp() {
  help.hidden = !ready || !helpVisible;
  help.textContent = active
    ? `WASD move · Mouse look · Shift ${flying ? 'faster' : 'sprint'} · ${flying ? 'Space / Ctrl up / down' : 'Space jump'} · F ${flying ? 'walk' : 'fly'} · R reset · H hide · Esc release`
    : 'Click the map to explore · WASD move · Mouse look · F fly / walk';
}

function pause() {
  active = false;
  keys.clear();
  player?.setEnabled(false);
  updateHelp();
}

function reset() {
  flying = false;
  keys.clear();
  player.setPosition(new THREE.Vector3(...data.spawn.position).add(new THREE.Vector3(0, 3, 0)));
  camera.rotation.set(0, data.spawn.yaw - Math.PI / 2, 0);
  // Settle onto the exported floor before the first click.
  player.setEnabled(true);
  for (let i = 0; i < 90; i++) player.update(1 / 120, {});
  player.setEnabled(active);
  updateHelp();
}

function toggleFly() {
  flying = !flying;
  if (!flying) {
    player.setPosition(camera.position.clone().add(new THREE.Vector3(0, -player.eyeHeight, 0)));
  }
  player.setEnabled(active && !flying);
  keys.clear();
  updateHelp();
}

function prepareMaterials(root) {
  const prepared = new Map();
  const hiddenEntities = new Set(data.hiddenEntities);
  root.traverse(object => {
    const offset = data.entityOffsets[object.userData.entityId];
    if (offset) { object.position.add(new THREE.Vector3(...offset)); object.updateMatrix(); }
    if (object.userData.collisionOnly || hiddenEntities.has(object.userData.entityId)) object.visible = false;
    if (!object.isMesh) return;
    const original = Array.isArray(object.material) ? object.material : [object.material];
    const converted = original.map(material => {
      if (prepared.has(material)) return prepared.get(material);
      const source = material.userData.sourceMaterialNames?.[0] || material.name;
      const base = source.startsWith('*') ? (source.match(/\(([^:)]+)/)?.[1] ?? source) : source.replace(/^[^:]+:(?=[mw]c\/)/, '');
      // GfxWorld retains editor masks and sky portals along with visible faces.
      // Hide these before instancing so the cube sky shows through the portals.
      const rule = data.materialRules[base];
      if (rule?.hidden || /sky|shadowcaster|hdrportal|caulk|portal_nodraw|clip_player|lightshaft|mtl_player_icon|mtl_clan_tag/i.test(base)) {
        material.visible = false;
      }
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
      prepared.set(material, material);
      return material;
    });
    object.material = Array.isArray(object.material) ? converted : converted[0];
  });
}

async function load() {
  renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;
  renderer.domElement.setAttribute('aria-label', 'Ascension map');
  ctx.attach(renderer);
  gfx = bindExploreGraphics({ctx, renderer, camera, maxPixelRatio: Math.min(devicePixelRatio, 1.5), baseFar: 70000});

  const response = await fetch('./ascension/map-data.json');
  if (!response.ok) throw new Error(`Map data failed to load (${response.status})`);
  data = await response.json();
  camera.position.fromArray(data.spawn.position).add(new THREE.Vector3(0, 60, 0));
  camera.rotation.set(0, data.spawn.yaw - Math.PI / 2, 0);
  scene.add(new THREE.AmbientLight(0xc3d6e8, .9));
  scene.add(new THREE.HemisphereLight(0xc0cddd, 0x4e4a45, 1.7));
  const sun = new THREE.DirectionalLight(0xe2e9ef, 2.0);
  sun.position.set(-.6, .7, -.4); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xa2bbc5, .55);
  fill.position.set(.5, .3, -.7); scene.add(fill);

  let steps = 0;
  const showStatus = text => ctx.progress(text, Math.min(.92, .05 + (++steps) * .03));
  const manager = new THREE.LoadingManager();
  manager.onError = url => errors.push(`Asset failed: ${url}`);
  showStatus('Loading Ascension…');
  const gltf = await loadMapGltf('./ascension/ascension.gltf', {label: 'Ascension', onStatus: showStatus, pack: 'asset-pack/ascension.pack'});
  const textureReport = await settleTextures({onStatus: showStatus});
  showStatus('Loading Ascension collision and sky…');
  const [collider, sky] = await Promise.all([
    loadCollisionWorld({metadataUrl: './ascension/collision.json', onProgress: ({loaded, total}) => showStatus(`Loading Ascension collision… ${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`)}),
    new THREE.CubeTextureLoader(manager).loadAsync(data.sky.faces.map(face => './ascension/' + face)),
  ]);
  if (errors.length) throw new Error(errors.join('\n'));
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  scene.backgroundRotation.x = -Math.PI / 2;
  collision = collider;
  world = gltf.scene;
  prepareMaterials(world);
  applyChalkTransparency(world);
  wallGuns = createWallGuns({entities: data.entities, root: world, camera, promptElement: document.getElementById('prompt'), offsets: data.entityOffsets});
  optimization = optimizeStaticScene(world, {cellSize: 640, verticalCellSize: 384});
  scene.add(world);
  player = new PlayerController(camera, collision, {
    radius: 15, height: 70, eyeHeight: 60, moveSpeed: 190, sprintSpeed: 285,
    crouchSpeed: 90, gravity: 800, jumpHeight: 39, stepHeight: 18, groundProbeDistance: 4,
  });
  reset();
  ready = true;
  const missingTextures = textureWarning(textureReport);
  if (missingTextures) { errors.push(missingTextures); console.warn(missingTextures); status.textContent = missingTextures; }
  status.hidden = !missingTextures;
  updateHelp();
  ctx.setControls(CONTROLS);
  ctx.setHint('Click to capture the mouse · Esc to pause');
  ctx.expose('ascension', {
    ready, scene, camera, player, collision, renderer, data, world,
    debug: {
      reset,
      snapshot: () => ({ready, active, flying, grounded: player.isGrounded, position: camera.position.toArray(),
        feet: player.getFeetPosition().toArray(), rotation: camera.rotation.toArray().slice(0, 3),
        fps, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        optimization, errors: [...errors]}),
    },
  });
  let previous = performance.now(), frameTime = 0, frames = 0;
  renderer.setAnimationLoop(now => {
    if (disposed) return;
    const dt = Math.min((now - previous) / 1000, .25); previous = now;
    if (active) {
      const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const z = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (flying) {
        camera.getWorldDirection(forward);
        right.setFromMatrixColumn(camera.matrix, 0);
        wish.copy(forward).multiplyScalar(z).addScaledVector(right, x);
        wish.y += Number(keys.has('Space')) - Number(keys.has('ControlLeft') || keys.has('ControlRight'));
        if (wish.lengthSq()) camera.position.addScaledVector(wish.normalize(), (sprint ? 1800 : 600) * dt);
      } else {
        for (let remaining = dt; remaining > 0;) {
          const step = Math.min(remaining, .05);
          player.update(step, {forward: z, strafe: x, sprint, jump: keys.has('Space'),
            crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC')});
          remaining -= step;
        }
        if (player.getFeetPosition().y < collision.metadata.bounds.min[1] - 600) reset();
      }
    }
    if (active) { gfx.sample(dt * 1000); wallGuns.update(); }
    renderer.render(scene, camera);
    frames++; frameTime += dt;
    if (frameTime >= .5) { fps = Math.round(frames / frameTime); frames = 0; frameTime = 0; }
    if (!debug.hidden) debug.textContent = `${fps} FPS · ${renderer.info.render.calls} calls\n${flying ? 'Fly' : 'Walk'} · ${camera.position.toArray().map(n => n.toFixed(1)).join(', ')}`;
  });
}

function setActive(value) {
  if (!value) { pause(); return; }
  active = true; keys.clear(); player?.setEnabled(!flying); updateHelp();
}
ctx.listen(document, 'mousemove', e => {
  if (!active) return;
  camera.rotation.y -= e.movementX * .002;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - e.movementY * .002, -1.55, 1.55);
});
addEventListener('keydown', e => {
  if (!active) return;
  if (['Space', 'F3'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyF') toggleFly();
  if (e.code === 'KeyE') wallGuns?.interact();
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyH') { helpVisible = !helpVisible; updateHelp(); }
  if (e.code === 'F3') debug.hidden = !debug.hidden;
  if (e.code === 'Escape') ctx.pause();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer?.setSize(innerWidth, innerHeight);
});
await load();
return { setActive };
}

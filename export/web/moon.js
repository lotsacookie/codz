import * as THREE from 'three';
import { loadMapGltf, settleTextures, textureWarning } from './map-assets.js';
import { PlayerController } from './player-controller.js';
import { CollisionWorld, loadCollisionWorld } from './collision-world.js';
import { optimizeStaticScene } from './scene-optimizer.js';
import { MoonState, contains, environmentAt } from './moon-rules.js';
import { MoonNavigation } from './moon-navigation.js';
import { MoonCombat } from './moon-combat.js';
import { MoonFeatures } from './moon-features.js';
import { MoonPresentation } from './moon-presentation.js';
import { loadMoonWater } from './moon-water.js';
import { createZombieTouch } from './zombies-touch.js';

const $ = id => document.getElementById(id), keys = new Set(), errors = [];
const vector = a => new THREE.Vector3(...a);
const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1 : 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.45;
renderer.autoClear = false;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x010306);
scene.add(new THREE.AmbientLight(0xb4c6d7, 1.1), new THREE.HemisphereLight(0xc6d6ea, 0x434853, 1.7));
const sun = new THREE.DirectionalLight(0xe7efff, 2.4); sun.position.set(-.6, 1, -.3); scene.add(sun);
const fill = new THREE.DirectionalLight(0x8191b3, .6); fill.position.set(1, .3, .5); scene.add(fill);
const camera = new THREE.PerspectiveCamera(78, innerWidth/innerHeight, 1, 70000); camera.rotation.order = 'YXZ';
let data, state, player, collision, ready = false, active = false, onMoon = false, checkpoint = 'area51', environment, target;
let navigation, combat, features, presentation, water, mode = new URLSearchParams(location.search).get('mode') === 'explore' ? 'explore' : 'survival';
let notice = '', noticeLeft = 0, debugVisible = false, frames = 0, frameTime = 0, fps = 0;
const objects = new Map(), parts = new Map(), opened = new Set();
const labels = {nml_zone: 'No Man’s Land', bridge_zone: 'Receiving Bay', water_zone: 'Lunar Surface', cata_left_start_zone: 'Tunnel 6', cata_left_middle_zone: 'Tunnel 6', cata_right_start_zone: 'Tunnel 11', cata_right_middle_zone: 'Tunnel 11', cata_right_end_zone: 'Tunnel 11', generator_zone: 'Power / MPD', generator_exit_east_zone: 'Laboratories', enter_forest_east_zone: 'Upper Laboratories', forest_zone: 'Biodome', tower_zone_east: 'Laboratories', tower_zone_east2: 'Laboratories'};

function showNotice(text, duration = 4) { notice = text; noticeLeft = duration; }
let mousePrimary=false,mouseSecondary=false,mouseAim=false,touchFirePending=false;
const touchControls=createZombieTouch({moon:true,
  onReset:()=>{touchFirePending=false;},
  onLook:(x,y,sensitivity)=>{
    if(!active||combat.enabled&&combat.session.phase==='reviving')return;
    const scale=.005*sensitivity*(combat.ads?.5:1);
    camera.rotation.y-=x*scale;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-y*scale,-1.5,1.5);
  },
  onAction:action=>{
    if(!active||combat.enabled&&combat.session.phase==='reviving')return;
    const code={reload:'KeyR',melee:'KeyV',grenade:'KeyG',equipment:'KeyX',attachment:'KeyB'}[action];
    if(code)combat.key(code);
    if(action==='weapon')combat.switchWeapon();
    if(action==='use')interact();
    if(action==='suit'){state.toggleSuit();if(!state.hasSuit)showNotice('Find a P.E.S. station in Receiving Bay.');}
    if(action==='hack'&&combat.enabled){findTarget();if(!features.hackNearby(target))showNotice('Aim at a hackable target. Equip the Hacker first.');}
    if(action==='journal')$('journal').hidden=!$('journal').hidden;
  },
  onPause:()=>{pause();document.exitPointerLock();},
});
function pause() { active = false; keys.clear(); mousePrimary=mouseSecondary=mouseAim=touchFirePending=false;touchControls.reset();touchControls.setEnabled(false);if (player) player.setEnabled(false); combat?.pause(); $('menu').hidden = false; $('hud').hidden = true; $('visor').hidden = true; $('damage').style.opacity = 0; }
function resume() {
  if(!ready||combat.enabled&&combat.session.phase==='gameover')return;
  touchControls.reset();touchControls.setEnabled(true);active=true;player.setEnabled(true);combat.resume();$('menu').hidden=true;$('hud').hidden=false;$('start').innerHTML='RESUME <span>→</span>';
}
function start() {
  if (!ready) return;
  if(touchControls.mode){resume();return;}
  renderer.domElement.requestPointerLock()?.catch(() => { $('status').textContent = 'Click the start button to capture the mouse.'; });
}
$('start').addEventListener('click', async () => {if(combat?.enabled&&combat.session.phase==='gameover')await resetRun();start();});
$('new-run').addEventListener('click', async () => {await resetRun();start();});
$('explore').addEventListener('click', () => {mode='explore';combat.enabled=false;combat.enemies.reset();combat.pickups.reset();combat.clearTransient();camera.fov=78;camera.updateProjectionMatrix();setModeUi();start();});
function setModeUi(){
  $('destinations').hidden=mode!=='explore';$('combat-hud').hidden=mode!=='survival';
  $('mode-label').textContent=mode==='survival'?'MOON / SOLO SURVIVAL':'MOON / EXPLORATION';
  $('start').innerHTML=(mode==='survival'?'SURVIVE MOON':'EXPLORE MOON')+' <span>→</span>';
}
async function resetRun(){
  if(!ready)return;
  pause();ready=false;mode='survival';combat.enabled=true;opened.clear();Object.assign(state,new MoonState(data.rules));
  for(const part of parts.values()){part.amount=0;part.delta.set(0,0,0);if(part.object)part.object.position.copy(part.origin);}
  navigation.setDoors(parts);await combat.reset();features.reset();presentation.reset();relocate('area51');setModeUi();ready=true;
  $('status').textContent='500 points. M1911. Reach the teleporter and survive.';
}
function endRun(){
  document.exitPointerLock();pause();$('start').innerHTML='TRY AGAIN <span>→</span>';
  const s=combat.session;$('status').textContent=`Game over · ${s.kills} kills · ${s.moonStarted?'Round '+s.round:'No Man’s Land'} · ${Math.floor(s.time)} seconds`;
}
document.querySelectorAll('[data-destination]').forEach(button => button.addEventListener('click', () => {
  if (!ready) return;
  relocate(button.dataset.destination);
  start();
}));
document.addEventListener('pointerlockchange', () => {
  if(touchControls.mode&&!document.pointerLockElement)return;
  if (document.pointerLockElement !== renderer.domElement) { pause(); return; }
  resume();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { document.exitPointerLock(); pause(); } });
addEventListener('blur', () => { document.exitPointerLock(); pause(); });
addEventListener('mousemove', e => { if (active&&document.pointerLockElement===renderer.domElement) { const sensitivity=combat?.enabled&&combat.ads?.0012:.002;camera.rotation.y -= e.movementX*sensitivity; camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x-e.movementY*sensitivity, -1.5, 1.5); } });
addEventListener('mousedown',e=>{if(!active||!combat.enabled||e.sourceCapabilities?.firesTouchEvents||e.target.closest('#touch-controls'))return;if(e.button===0){mousePrimary=combat.primary=true;combat.pressed=true;}if(e.button===2){if(combat.session.def.dualWield){mouseSecondary=combat.secondary=true;combat.secondaryPressed=true;}else mouseAim=combat.ads=true;}});
addEventListener('mouseup',e=>{if(!combat||e.sourceCapabilities?.firesTouchEvents)return;if(e.button===0)mousePrimary=combat.primary=false;if(e.button===2){mouseAim=combat.ads=false;mouseSecondary=combat.secondary=false;}});
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',()=>{if(active)combat.switchWeapon();});
addEventListener('keydown', e => {
  if (['Space', 'F3', 'Tab'].includes(e.code)) e.preventDefault();
  if (!active) return;
  keys.add(e.code); if (e.repeat) return;
  combat.key(e.code);
  if (['KeyF', 'KeyE'].includes(e.code)) interact();
  if(e.code==='KeyH'&&combat.enabled){findTarget();if(!features.hackNearby(target))showNotice('Aim at a hackable box, perk, barricade, door or wall weapon. Equip the Hacker first.');}
  if (e.code === 'KeyQ') { state.toggleSuit(); if (!state.hasSuit) showNotice('Find a P.E.S. station in Receiving Bay.'); }
  if (e.code === 'F3') { debugVisible = !debugVisible; $('debug').hidden = !debugVisible; }
  if (e.code === 'Tab') $('journal').hidden = !$('journal').hidden;
  if (e.code === 'Escape') { document.exitPointerLock(); pause(); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();if(combat){combat.viewCamera.aspect=camera.aspect;combat.viewCamera.updateProjectionMatrix();} renderer.setSize(innerWidth, innerHeight); });
addEventListener('error', e => errors.push(e.message));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));

function relocate(destination, entityId = null) {
  const landmark = data.landmarks[destination], entity = data.entities[entityId ?? landmark.entity];
  checkpoint = destination; onMoon = destination !== 'area51';
  if(combat?.session)combat.enterArea(onMoon);
  scene.background.set(onMoon ? 0x010306 : 0x4c545e);
  player.setPosition(vector(entity.position).add(new THREE.Vector3(0, 3, 0)));
  // Original angles describe a +X forward vector; Three cameras face -Z.
  camera.rotation.set(0, entity.yaw - Math.PI/2, 0);
  state.exposure = 0; state.teleport = null; state.cooldown = 4;
  showNotice(onMoon && !state.hasSuit ? 'Find the P.E.S. station. F to equip life support.' : landmark.label);
  if (destination === 'area51') showNotice('Reach the teleporter at the far end of the yard.', 7);
  environment = environmentAt(data, player.getFeetPosition().toArray(), state.power, onMoon);
}

function makePart(entity, object) {
  const box = entity.bounds ? new THREE.Box3(vector(entity.bounds[0]), vector(entity.bounds[1])) : object ? new THREE.Box3().setFromObject(object) : null;
  if (!box || box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  if (Math.min(size.x, size.y, size.z) < .01) return null;
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.translate(...box.getCenter(new THREE.Vector3()).toArray());
  geometry.computeBoundingBox();
  return {entity, object, origin: object?.position.clone(), delta: new THREE.Vector3(), amount: 0, collider: new CollisionWorld(geometry)};
}
function capsuleIntersect(capsule) {
  const hit = collision.capsuleIntersect(capsule); if (hit) return hit;
  for (const part of parts.values()) {
    if(part.removable&&part.amount>=1)continue;
    const local = capsule.clone(); local.translate(part.delta.clone().negate());
    const contact = part.collider.capsuleIntersect(local); if (contact) return contact;
  }
  if(combat?.enabled)for(const z of combat.enemies.list){
    const p=z.root.position,feet=capsule.start.y-capsule.radius,top=capsule.end.y+capsule.radius;
    if(feet>p.y+65||top<p.y+4)continue;
    const normal=new THREE.Vector3(capsule.start.x-p.x,0,capsule.start.z-p.z),distance=normal.length(),depth=capsule.radius+15-distance;
    if(depth>0)return {normal:distance>.001?normal.divideScalar(distance):new THREE.Vector3(1,0,0),depth};
  }
  return false;
}
function rayIntersect(ray, near = 0, far = Infinity) {
  let hit = collision.rayIntersect(ray, near, far);
  for (const part of parts.values()) {
    if(part.window||part.removable&&part.amount>=1)continue;
    const local = ray.clone(); local.origin.sub(part.delta);
    const contact = part.collider.rayIntersect(local, near, hit ? Math.min(hit.distance, far) : far);
    if (contact) { contact.position.add(part.delta); hit = contact; }
  }
  return hit;
}
function updateDoors(dt) {
  let changed=false;
  for (const door of data.doors) if (opened.has(door.name)) for (const id of door.parts) {
    const part = parts.get(id); if (!part || part.amount >= 1) continue;
    part.amount = Math.min(1, part.amount + dt/Math.max(.25, +(part.entity.script_transition_time || .6)));
    if(part.amount===1)changed=true;
    part.delta.copy(vector(part.entity.move || [0, 120, 0])).multiplyScalar(part.amount);
    if (part.object) part.object.position.copy(part.origin).add(part.delta);
  }
  if(changed)navigation?.setDoors(parts);
}
function findTarget() {
  target = null; let distance = 110;
  for (const e of data.entities) {
    const suit = e.zombie_equipment_upgrade === 'equip_gasmask_zm';
    const power = e.targetname === 'use_elec_switch';
    const door = data.doors.find(d => !opened.has(d.name) && d.triggers.includes(e.id));
    const weapon=combat?.enabled&&e.targetname==='weapon_upgrade'&&combat.data.weapons[e.zombie_weapon_upgrade];
    if ((!suit || state.hasSuit) && (!power || state.power) && !door && !weapon) continue;
    const d = e.bounds ? new THREE.Box3(vector(e.bounds[0]), vector(e.bounds[1])).distanceToPoint(camera.position) : camera.position.distanceTo(vector(e.position));
    if (d >= distance) continue;
    // A short sight check prevents collecting equipment through walls.
    const center = vector(e.position), direction = center.clone().sub(camera.position);
    if(direction.length()>25&&direction.clone().normalize().dot(camera.getWorldDirection(new THREE.Vector3()))<.25)continue;
    const wall = rayIntersect(new THREE.Ray(camera.position.clone(), direction.clone().normalize()), 1, direction.length());
    if (!door && wall && wall.distance < direction.length()-28) continue;
    distance = d; target = {entity: e, door, weapon, kind: door ? 'door' : suit ? 'suit' : weapon ? 'weapon' : 'power'};
  }
  if(target?.kind==='weapon'){
    const owned=combat.session.inventory.find(w=>w.id===target.weapon.id),price=owned?(owned.upgraded?4500:target.weapon.ammoPrice??Math.ceil(target.weapon.price/2)):target.weapon.price;
    const displayed=owned&&combat.session.hackedWeapons.has(target.weapon.id)?owned.upgraded?(target.weapon.ammoPrice??Math.ceil(target.weapon.price/2)):4500:price;
    target.label=`F · ${target.weapon.name}${owned?' ammo':''} · ${displayed}`;
  }
  const extra=combat.enabled?features?.findTarget(distance):null;
  if(extra){target={kind:'feature',feature:extra};return (extra.label.startsWith('Hold F')?'':'F · ')+extra.label;}
  return target?.label??(target?.kind === 'door' ? 'F · Open ' + (target.entity.targetname === 'zombie_airlock_buy' ? 'airlock' : 'door')+(combat.enabled?' · '+target.door.cost:'') : target?.kind === 'suit' ? 'F · Equip P.E.S. life support' : target?.kind === 'power' ? 'F · Restore power' : '');
}
function interact() {
  findTarget(); if (!target) return false;
  if(target.kind==='feature')return features.interact(target.feature);
  if(combat.enabled&&!combat.session.canAct)return false;
  if (target.kind === 'suit') { state.equipSuit();combat.session.hacker=false;showNotice('P.E.S. equipped · Q to remove or replace the helmet.'); }
  if (target.kind === 'power') { state.power = true; combat.session.power=true;showNotice('Power restored. Pressurized rooms now have normal gravity.'); }
  if (target.kind === 'door') { if(combat.enabled&&!combat.session.buyDoor(target.door)){showNotice('Not enough points.');return false;}opened.add(target.door.name); showNotice('Passage opened', 2); }
  if (target.kind === 'weapon') return combat.buyWeapon(target.weapon.id);
  return true;
}
function update(dt) {
  touchControls.setEnabled(active&&(!combat.enabled||!['reviving','gameover'].includes(combat.session.phase)),active);
  const touch=touchControls.input.read();
  // Keep a tap through the native sprint-out animation so a moving player
  // can fire a semi-automatic weapon as soon as it has been lowered.
  if(!touchControls.enabled)touchFirePending=false;
  touchFirePending ||= touch.firePressed;
  const touchWantsFire=touch.fire||touchFirePending;
  combat.primary=mousePrimary||touchWantsFire;
  if(touchFirePending&&combat.view.ready&&!['raise','melee','sprintIn','sprint','sprintOut'].includes(combat.view.mode)){
    combat.pressed=true;touchFirePending=false;
  }
  const secondary=mouseSecondary||(combat.session.def.dualWield&&touch.aim);
  combat.secondaryPressed ||= secondary&&!combat.secondary;combat.secondary=secondary;
  combat.ads=mouseAim||(touch.aim&&!combat.session.def.dualWield);
  const feet = player.getFeetPosition();
  environment = environmentAt(data, feet.clone().add(new THREE.Vector3(0, 35, 0)).toArray(), state.power, onMoon);
  if(combat.enabled)environment=features.environment(environment);
  combat.audio.environment(environment);
  player.gravity = environment.gravity;
  player.jumpSpeed = environment.lowGravity ? 190 : Math.sqrt(2*data.rules.normalGravity*39);
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS'))+touch.forward,strafe=Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+touch.strafe;
  const moving=Math.hypot(forward,strafe)>.01,sprint=((keys.has('ShiftLeft')||keys.has('ShiftRight'))&&keys.has('KeyW')||touch.sprint)&&!touchWantsFire&&(!combat.enabled||!combat.ads&&!combat.session.reloadLeft&&!combat.session.meleeLeft);
  player.moveSpeed=combat.session.perks.has('specialty_longersprint')?209:190;player.sprintSpeed=combat.session.perks.has('specialty_longersprint')?330:285;
  if(!features?.flight&&combat.session.phase!=='reviving')player.update(dt, {forward,strafe,sprint,jump:keys.has('Space'),jumpPressed:touch.jump,crouch:keys.has('ControlLeft')||keys.has('ControlRight')||keys.has('KeyC')||touch.crouch});
  updateDoors(dt);
  const position = player.getFeetPosition().add(new THREE.Vector3(0, 35, 0)).toArray();
  const pad = data.entities.find(e => ['nml_teleporter', 'generator_teleporter'].includes(e.targetname) && contains(e.bounds, position));
  const event = state.update(dt, environment, pad?.targetname);
  if (event.teleport) {
    if (event.teleport === 'nml_teleporter') relocate('receiving');
    else relocate('area51', data.returnSpawn);
  }
  if (event.suffocated || player.getFeetPosition().y < -2000) {
    if(combat.enabled){combat.damage(10000);return;}
    relocate(checkpoint); showNotice(event.suffocated ? 'No oxygen. Returned to the arrival point — find a P.E.S. station.' : 'Returned to the arrival point.', 7);
  }
  combat.update(dt,{moving,sprint});
  if(combat.enabled)features.update(dt,keys.has('KeyF')||keys.has('KeyE')||keys.has('KeyH')||touch.use||touch.hack);
  presentation.update(dt,environment);
  noticeLeft = Math.max(0, noticeLeft-dt);
  $('notice').textContent = noticeLeft ? (touchControls.mode?notice.replace('F to equip','Tap USE to equip'):notice) : '';
  $('prompt').textContent = state.teleport ? `Teleporting in ${(data.rules.teleportSeconds-state.teleport.elapsed).toFixed(1)}…` : findTarget();
  if(touchControls.mode)$('prompt').textContent=$('prompt').textContent.replace(/\bF\s*·/g,'USE ·').replace('Hold F','Hold USE').replace('H to hack','Hold HACK');
  $('visor').hidden = !state.suit;
  $('location').textContent = labels[environment.zone] || (environment.zone?.startsWith('airlock') ? 'Airlock' : onMoon ? 'Griffin Station' : 'No Man’s Land');
  $('gravity').textContent = environment.lowGravity ? 'LOW GRAVITY' : 'NORMAL GRAVITY';
  $('power').textContent = state.power ? 'POWER ON' : 'POWER OFF';
  $('suit').textContent = state.suit ? 'P.E.S. ACTIVE' : state.hasSuit ? 'P.E.S. OFF · Q TO EQUIP' : 'P.E.S. NOT ACQUIRED';
  if(touchControls.mode)$('suit').textContent=$('suit').textContent.replace('Q TO EQUIP','TAP P.E.S.');
  $('oxygen').hidden = environment.breathable || state.suit;
  $('air').value = data.rules.suffocationSeconds-state.exposure;
  $('damage').style.opacity = active?Math.max(Math.min(.7, state.exposure/data.rules.suffocationSeconds*.7),combat.enabled?(1-combat.session.health/combat.session.maxHealth)*.8:0):0;
  if(combat.enabled){
    const s=combat.session;$('round').textContent=s.area==='earth'?'NO MAN’S LAND':'ROUND '+s.round;
    $('remaining').textContent=s.area==='earth'?'REACH THE TELEPORTER':s.phase==='preparing'?'STARTS IN '+Math.max(0,Math.ceil(s.countdown)):(s.total-s.killed)+' REMAINING';
    $('points').textContent=s.points.toLocaleString();$('health').textContent=Math.ceil(s.health)+' / '+s.maxHealth;
    $('weapon').textContent=s.def.name;$('ammo').textContent=s.weapon.mag+' / '+s.weapon.reserve;
    $('weapon-status').textContent=s.phase==='reviving'?'QUICK REVIVE…':s.pack?'WEAPON IN PACK-A-PUNCH':s.reloadLeft?'RELOADING':s.weapon.mag===0?'R · RELOAD':'G · '+s.grenades+' GRENADES';
    if(touchControls.mode)$('weapon-status').textContent=$('weapon-status').textContent.replace('R · RELOAD','TAP RELOAD').replace('G · ','');
    if(s.effects.death_machine>s.time){$('weapon').textContent='DEATH MACHINE';$('ammo').textContent=Math.ceil(s.effects.death_machine-s.time)+'s';}
    $('crosshair').textContent=combat.hitUntil>s.time?'×':'+';
    $('effects').textContent=Object.entries(s.effects).filter(([key,time])=>time>s.time&&['double_points','insta_kill'].includes(key)).map(([key,time])=>(key==='double_points'?'Double Points':'Insta-Kill')+' '+Math.ceil(time-s.time)+'s').join(' · ');
  }
}
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
async function load() {
  const response = await fetch('moon/map-data.json');
  if (!response.ok) throw new Error('Moon data is missing. Run .tools/rebuild-moon.ps1.');
  data = await response.json(); state = new MoonState(data.rules);
  const showStatus = text => { $('status').textContent = text; };
  showStatus('Loading Moon…');
  const gltf = await loadMapGltf('moon/moon.gltf', {label: 'Moon', onStatus: showStatus, pack: 'asset-pack/moon.pack'});
  const textureReport = await settleTextures({onStatus: showStatus});
  showStatus('Loading Moon collision…');
  const world = await loadCollisionWorld({metadataUrl: 'moon/collision.json', onProgress: ({loaded, total}) => showStatus(`Loading Moon collision… ${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`)});
  const missingTextures = textureWarning(textureReport);
  if (missingTextures) { errors.push(missingTextures); console.warn(missingTextures); $('error').hidden = false; $('error').textContent = missingTextures; }
  showStatus('Preparing Moon scene…'); await nextTask();
  collision = world; scene.add(gltf.scene); scene.updateMatrixWorld(true);
  showStatus('Loading Moon water…'); await nextTask();
  water = await loadMoonWater(gltf.scene);
  const hazardIds=data.entities.filter(e=>['digger_hangar_blocker','digger_teleporter_blocker'].includes(e.targetname)).map(e=>e.id);
  const windowGroups=new Set(data.entities.filter(e=>e.targetname==='exterior_goal').map(e=>e.target));
  const windowIds=data.entities.filter(e=>windowGroups.has(e.targetname)&&e.script_noteworthy==='clip').map(e=>e.id);
  const boardIds=data.entities.filter(e=>windowGroups.has(e.targetname)&&e.script_parameters?.startsWith('barricade_')).map(e=>e.id);
  const moving = new Set([...data.doors.flatMap(d => d.parts),...hazardIds,...windowIds,...boardIds]), detach = [];
  gltf.scene.traverse(o => {
    if (o.userData.collisionOnly) o.visible = false;
    // Native sky materials use cubemap shaders; their flat DDS preview makes
    // opaque blue boxes in glTF. Use a clear sky until that shader is ported.
    if (o.isMesh && /(?:sky_day|mtl_skybox)/i.test(o.material?.name || '')) o.visible = false;
    if(o.isMesh&&/moon_vista_earth/i.test(o.material?.name||''))o.visible=false;
    if (o.userData.entityId !== undefined) {
      objects.set(o.userData.entityId, o);
      detach.push(o);
    }
  });
  for (const o of detach) { scene.attach(o); o.matrixAutoUpdate = true; }
  for (const id of moving) { const part = makePart(data.entities[id], objects.get(id)); if (part) {part.hazard=hazardIds.includes(id);part.window=windowIds.includes(id);part.removable=part.hazard||boardIds.includes(id);if(part.hazard)part.amount=1;parts.set(id, part);} }
  showStatus('Optimizing Moon…'); await nextTask();
  const optimization = optimizeStaticScene(gltf.scene, {cellSize: 1024});
  showStatus('Loading Moon navigation…'); await nextTask();
  navigation=new MoonNavigation(data);await navigation.load();navigation.setDoors(parts);
  player = new PlayerController(camera, {capsuleIntersect, rayIntersect}, {radius: 15, height: 70, eyeHeight: 60, moveSpeed: 190, sprintSpeed: 285, crouchSpeed: 90, gravity: 800, jumpHeight: 39, stepHeight: 18, groundProbeDistance: 4});
  $('status').textContent='Loading Moon zombies and weapons…';
  const worldApi={navigation,path:(a,b)=>navigation.path(a,b),closest:(p,e)=>navigation.closest(p,e),raycast:rayIntersect,
    lineClear:(a,b)=>{const d=b.clone().sub(a);return !rayIntersect(new THREE.Ray(a,d.clone().normalize()),1,Math.max(1,d.length()-4));},
    zoneAt:p=>environmentAt(data,p.clone().add(new THREE.Vector3(0,35,0)).toArray(),state.power,navigation.area==='moon').zone,
    lowGravity:p=>{const env=environmentAt(data,p.clone().add(new THREE.Vector3(0,35,0)).toArray(),state.power,navigation.area==='moon');return (features?.environment(env)??env).lowGravity;}};
  combat=new MoonCombat(scene,camera,worldApi,{notice:showNotice,end:endRun,feet:()=>player.getFeetPosition()});await combat.load();combat.enabled=mode==='survival';
  $('status').textContent='Preparing station systems and quest…';
  features=new MoonFeatures({data,state,combat,scene,camera,player,objects,opened,parts,navigation,notice:showNotice,raycast:rayIntersect});await features.load();
  presentation=new MoonPresentation(scene,camera,features);await presentation.load();
  $('status').textContent='Preparing Moon graphics…'; await nextTask();
  relocate('area51'); water.captureReflection(renderer, scene);
  // Compile shaders in parallel behind the loading screen instead of in one long freeze on the first frame.
  try { await Promise.race([Promise.all([renderer.compileAsync(scene, camera), combat.viewScene && renderer.compileAsync(combat.viewScene, combat.viewCamera)]), new Promise(resolve => setTimeout(resolve, 20000))]); } catch (error) { console.warn('[moon] shader precompile skipped', error); }
  player.enabled = false; ready = true;setModeUi();
  $('status').textContent = mode==='survival'?'500 points. M1911. Reach the teleporter and survive.':'Exploration: free doors and destination shortcuts.';
  $('new-run').disabled=false;$('explore').disabled=false;
  $('start').disabled = false; document.querySelectorAll('[data-destination]').forEach(b => b.disabled = false);
  window.moon = {ready: true, data, state, player, camera, scene, renderer, collision, parts, opened, errors, optimization,combat,navigation,features,presentation,
    debug: {relocate, interact, update, resetRun, pause, resume, environment: () => environment, target: () => target,
      snapshot: () => ({input:{touch:touchControls.getState(),primary:combat.primary,ads:combat.ads},player:{...player.state,rotation:camera.rotation.toArray().slice(0,3)},position: player.getFeetPosition().toArray(), grounded: player.isGrounded, active, mode, checkpoint, environment, power: state.power, hasSuit: state.hasSuit, suit: state.suit, exposure: state.exposure, doors: [...opened], combat:combat.snapshot(), fps, drawCalls: renderer.info.render.calls, errors: [...errors]})}};
}
load().catch(error => { errors.push(String(error)); $('status').textContent = 'Moon could not load.'; $('error').hidden = false; $('error').textContent = error.message; console.error(error); });
let previous = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.max(0, (now-previous)/1000); previous = now;
  if (active) water?.update(Math.min(.25, dt));
  // Preserve real-time timers on slower GPUs while keeping collision steps small.
  for(let remaining=Math.min(.25,dt);active&&remaining>0;){const step=Math.min(.05,remaining);update(step);remaining-=step;}
  if(!ready){previous=now;return;}
  renderer.clear();renderer.render(scene, camera);
  if(ready&&active&&combat.enabled){renderer.clearDepth();renderer.render(combat.viewScene,combat.viewCamera);}
  frames++; frameTime += dt;
  if (frameTime >= .5) { fps = Math.round(frames/frameTime); frames = 0; frameTime = 0; }
  if (debugVisible && ready) $('debug').textContent = `${fps} FPS · ${renderer.info.render.calls} calls\n${player.getFeetPosition().toArray().map(n => n.toFixed(1)).join(', ')}\n${environment?.zone || 'outside volume'} · gravity ${player.gravity}\n${opened.size}/${data.doors.length} door groups open`;
});

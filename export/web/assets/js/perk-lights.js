import * as THREE from 'three';
import { perkLightColor, isPerkLit, lightLevel, machineTargets } from './perk-lights-data.js';

const GLOW_URL = 'textures/fxt_light_glow.png';
let glowTexture = null, started = false;
function glow() {
  if (!started && typeof document !== 'undefined') {
    started = true;
    new THREE.TextureLoader().load(GLOW_URL, texture => { texture.colorSpace = THREE.SRGBColorSpace; glowTexture = texture; });
  }
  return glowTexture;
}

// Shared perk machine glow for every map: a sign glow plus a soft halo on each machine.
export class PerkLights {
  constructor(scene) {
    this.scene = scene;
    this.machines = [];
    this.entities = null;
    this.time = 0;
  }
  addObject(perk, object) { this.#add({ perk, object }); }
  addPoint(perk, position) { this.#add({ perk, point: position.clone() }); }
  #add(machine) {
    machine.seed = this.machines.length * 1.7;
    machine.sprites = null;
    this.machines.push(machine);
  }
  sync(entities, world) {
    if (!entities || this.entities === entities) return;
    this.entities = entities;
    for (const target of machineTargets(entities)) {
      if (!target.perk || this.machines.some(m => m.id === target.id)) continue;
      this.#add({ id: target.id, perk: target.perk, modelId: target.modelId, fallback: target.position, world });
    }
  }
  #anchor(machine) {
    const object = machine.object ?? (machine.modelId != null ? machine.world?.entities?.get?.(machine.modelId) : null);
    if (object) {
      const box = new THREE.Box3().setFromObject(object);
      if (!box.isEmpty()) return new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - (box.max.y - box.min.y) * 0.12, (box.min.z + box.max.z) / 2);
    }
    if (machine.point) return machine.point;
    if (machine.fallback && machine.modelId == null) return new THREE.Vector3(...machine.fallback).add(new THREE.Vector3(0, 40, 0));
    return null;
  }
  #sprites(machine) {
    const texture = glow();
    if (!texture) return null;
    const at = this.#anchor(machine);
    if (!at) return null;
    const color = perkLightColor(machine.perk);
    const make = (size, opacity) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      sprite.scale.setScalar(size);
      sprite.position.copy(at);
      sprite.userData.base = opacity;
      this.scene.add(sprite);
      return sprite;
    };
    return [make(46, 0.9), make(150, 0.28)];
  }
  update(dt, session = null, entities = null, world = null) {
    this.time += dt;
    if (entities) this.sync(entities, world);
    for (const machine of this.machines) {
      machine.sprites ??= this.#sprites(machine);
      if (!machine.sprites) continue;
      const lit = isPerkLit(machine.perk, session?.power);
      const level = lit ? lightLevel(this.time, machine.perk, machine.seed) : 0;
      for (const sprite of machine.sprites) {
        sprite.visible = level > 0.01;
        sprite.material.opacity = sprite.userData.base * level;
      }
    }
  }
  clear() {
    for (const machine of this.machines) for (const sprite of machine.sprites ?? []) { this.scene.remove(sprite); sprite.material.dispose(); }
    this.machines.length = 0;
    this.entities = null;
  }
}

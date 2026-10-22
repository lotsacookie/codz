import * as THREE from 'three';
import { loadAtlas, randomFrame } from './fx-atlas.js';

const FLASH_ATLAS = 'textures/fxt_fire_gas_flash.png';
const SMOKE_ATLAS = 'textures/fxt_smk_puff.png';
const FLASH_SCALE = 1.25;
const PAP_TINT = Object.freeze([0.62, 0.26, 1]);

export function flashTint(profile) {
  return profile?.upgraded ? 1 : 0;
}

function flashMaterial(map) {
  const uniforms = { uPap: { value: 0 }, uPapTint: { value: new THREE.Vector3(...PAP_TINT) } };
  const material = new THREE.SpriteMaterial({
    map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false, fog: false
  });
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = shader => {
    shader.uniforms.uPap = uniforms.uPap;
    shader.uniforms.uPapTint = uniforms.uPapTint;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uPap;\nuniform vec3 uPapTint;\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat papLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\ndiffuseColor.rgb = mix(diffuseColor.rgb, uPapTint * papLum * 2.2, uPap);');
  };
  material.customProgramCacheKey = () => 'muzzle-flash-pap';
  return material;
}

export function createMuzzleFlash(tag) {
  const group = new THREE.Group();
  group.visible = false;
  tag.add(group);
  const atlas = loadAtlas(FLASH_ATLAS, 2);
  let burst = null;
  const state = { life: 0, total: 0.06 };
  return {
    group,
    get burst() { return burst; },
    fire(profile, ads = false) {
      const frame = randomFrame(atlas);
      if (!frame) return;
      const size = profile.size * FLASH_SCALE * (ads ? 0.72 : 1) * (0.85 + Math.random() * 0.35);
      state.life = state.total = 0.045 + Math.random() * 0.03;
      if (!burst) {
        burst = new THREE.Sprite(flashMaterial(frame));
        burst.renderOrder = 10;
        group.add(burst);
      }
      burst.material.map = frame;
      burst.material.userData.uniforms.uPap.value = flashTint(profile);
      burst.scale.setScalar(size * 1.6);
      burst.material.rotation = (Math.random() - 0.5) * 0.9;
      burst.material.opacity = 0.95;
      group.visible = true;
    },
    update(dt) {
      if (state.life <= 0) return;
      state.life -= dt;
      if (state.life <= 0) { group.visible = false; return; }
      const k = state.life / state.total;
      if (burst) burst.material.opacity = Math.min(1, k * 1.4) * 0.95;
    },
    ndc(viewCamera) {
      viewCamera.updateMatrixWorld();
      return tag.getWorldPosition(new THREE.Vector3()).project(viewCamera);
    },
    dispose() {
      group.removeFromParent();
      burst?.material.dispose();
    }
  };
}

export class MuzzleSmoke {
  constructor(scene, limit = 56) {
    this.scene = scene;
    this.limit = limit;
    this.puffs = [];
    this.atlas = loadAtlas(SMOKE_ATLAS, 2);
  }

  emit(ndc, camera, profile, ads = false) {
    if (!this.atlas.frames.length) return;
    camera.updateMatrixWorld();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const ray = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const origin = camera.position.clone().addScaledVector(ray, 22 + profile.size * 0.8);
    const count = Math.max(1, Math.round(profile.puffs * (ads ? 0.7 : 1)));
    for (let i = 0; i < count; i++) this.spawn(origin, forward, right, up, profile);
  }

  spawn(origin, forward, right, up, profile) {
    const frame = randomFrame(this.atlas);
    if (!frame) return;
    if (this.puffs.length >= this.limit) this.remove(this.puffs[0]);
    const material = new THREE.SpriteMaterial({ map: frame, color: 0xb9b9b9, transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(material);
    const size = profile.size * (0.5 + Math.random() * 0.35);
    sprite.position.copy(origin)
      .addScaledVector(forward, Math.random() * 5)
      .addScaledVector(right, (Math.random() - 0.5) * profile.size * 0.5)
      .addScaledVector(up, (Math.random() - 0.5) * profile.size * 0.4);
    sprite.scale.setScalar(size);
    material.rotation = Math.random() * Math.PI * 2;
    sprite.renderOrder = 5;
    const velocity = forward.clone().multiplyScalar(45 + Math.random() * profile.smokeSpeed)
      .addScaledVector(right, (Math.random() - 0.5) * 26)
      .addScaledVector(up, 8 + Math.random() * 20);
    this.scene.add(sprite);
    this.puffs.push({
      sprite, velocity, age: 0,
      life: profile.smokeLife * (0.75 + Math.random() * 0.6),
      size0: size, size1: size * (3 + Math.random() * 2),
      alpha: profile.smokeAlpha * (0.7 + Math.random() * 0.5),
      spin: (Math.random() - 0.5) * 0.8
    });
  }

  update(dt) {
    for (const puff of [...this.puffs]) {
      puff.age += dt;
      const t = puff.age / puff.life;
      if (t >= 1) { this.remove(puff); continue; }
      puff.velocity.multiplyScalar(Math.exp(-dt * 2.2));
      puff.velocity.y += 12 * dt;
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      const grow = 1 - (1 - t) * (1 - t);
      puff.sprite.scale.setScalar(puff.size0 + (puff.size1 - puff.size0) * grow);
      puff.sprite.material.opacity = puff.alpha * Math.min(1, t / 0.1) * Math.pow(1 - t, 1.5);
      puff.sprite.material.rotation += puff.spin * dt;
    }
  }

  remove(puff) {
    puff.sprite.removeFromParent();
    puff.sprite.material.dispose();
    const index = this.puffs.indexOf(puff);
    if (index >= 0) this.puffs.splice(index, 1);
  }

  dispose() {
    for (const puff of [...this.puffs]) this.remove(puff);
  }
}

import * as THREE from 'three';
import { loadAtlas, randomFrame } from './fx-atlas.js';

const HOLE_SIZE = 4.2;
const MAX_HOLES = 64;
const SURFACE_LIFT = 0.12;
// Real T5 decals/sprites; the canvas-drawn versions below are used until these load (or if they fail).
const HOLE_DECALS = ['textures/~-gbullethole1.png', 'textures/~-gbullethole2.png'];
const DUST_ATLAS = 'textures/fxt_smk_puff.png';
const DUST_TINT = 0xb9b2a4;
const DUST_ALPHA = 0.55;

function canvasTexture(draw, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawHole(ctx, size, cracks) {
  const c = size / 2;
  const halo = ctx.createRadialGradient(c, c, 1, c, c, c);
  halo.addColorStop(0, 'rgba(18,15,12,0.55)');
  halo.addColorStop(0.45, 'rgba(32,28,24,0.32)');
  halo.addColorStop(1, 'rgba(32,28,24,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(20,17,14,0.55)';
  ctx.lineWidth = 1;
  for (const [angle, length] of cracks) {
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * 4, c + Math.sin(angle) * 4);
    ctx.lineTo(c + Math.cos(angle + 0.15) * length, c + Math.sin(angle + 0.15) * length);
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(c, c, 0, c, c, 7);
  core.addColorStop(0, 'rgba(4,3,3,1)');
  core.addColorStop(0.6, 'rgba(10,8,7,0.96)');
  core.addColorStop(1, 'rgba(10,8,7,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawDust(ctx, size) {
  const c = size / 2;
  const puff = ctx.createRadialGradient(c, c, 0, c, c, c);
  puff.addColorStop(0, 'rgba(190,184,172,0.85)');
  puff.addColorStop(0.5, 'rgba(160,154,144,0.4)');
  puff.addColorStop(1, 'rgba(150,144,134,0)');
  ctx.fillStyle = puff;
  ctx.fillRect(0, 0, size, size);
}

const normalFromHit = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

export function hitNormal(hit, ray, out = new THREE.Vector3()) {
  const triangle = hit?.triangle;
  if (triangle && typeof triangle.getNormal === 'function') {
    triangle.getNormal(out);
    if (out.lengthSq() > 1e-8) {
      if (out.dot(ray.direction) > 0) out.negate();
      return out;
    }
  }
  return out.copy(ray.direction).negate();
}

export class WallImpacts {
  constructor(scene) {
    this.scene = scene;
    this.holeTextures = [
      canvasTexture((ctx, size) => drawHole(ctx, size, [[0.2, 22], [1.4, 18], [2.6, 24], [3.9, 16], [5.1, 20]])),
      canvasTexture((ctx, size) => drawHole(ctx, size, [[0.7, 17], [2.1, 23], [3.3, 19], [4.6, 25]])),
    ];
    this.dustTexture = canvasTexture(drawDust);
    this.holeGeometry = new THREE.PlaneGeometry(HOLE_SIZE, HOLE_SIZE);
    this.holeMaterials = this.holeTextures.map(map => new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
    }));
    this.holes = [];
    this.next = 0;
    this.disposed = false;
    this.realHoles = [];
    this.dustAtlas = loadAtlas(DUST_ATLAS, 2);
    this.loadDecals();
  }

  loadDecals() {
    if (typeof document === 'undefined') return;
    const loader = new THREE.TextureLoader();
    HOLE_DECALS.forEach((url, index) => loader.load(url, texture => {
      if (this.disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      this.realHoles[index] = texture;
      const material = this.holeMaterials[index % this.holeMaterials.length];
      material.map = texture;
      material.needsUpdate = true;
    }, undefined, () => {}));
  }

  addHole(position, normal) {
    let mesh = this.holes[this.next];
    if (!mesh) {
      mesh = new THREE.Mesh(this.holeGeometry, this.holeMaterials[this.next % this.holeMaterials.length]);
      mesh.matrixAutoUpdate = true;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.holes[this.next] = mesh;
    }
    this.next = (this.next + 1) % MAX_HOLES;
    mesh.position.copy(position).addScaledVector(normal, SURFACE_LIFT);
    lookTarget.copy(mesh.position).add(normal);
    mesh.lookAt(lookTarget);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.visible = true;
    return mesh;
  }

  puffs(position, normal, particles) {
    for (let i = 0; i < 2; i++) {
      const frame = randomFrame(this.dustAtlas);
      const material = new THREE.SpriteMaterial({ map: frame ?? this.dustTexture, color: frame ? DUST_TINT : 0xffffff, transparent: true, depthWrite: false, opacity: 0.7, toneMapped: false });
      const sprite = new THREE.Sprite(material);
      const size = 3 + Math.random() * 2.5;
      sprite.scale.set(size, size, 1);
      sprite.position.copy(position).addScaledVector(normal, 0.6);
      this.scene.add(sprite);
      particles.push({
        mesh: sprite,
        fade: 0.45,
        alpha: frame ? DUST_ALPHA : 1,
        life: 0.3 + Math.random() * 0.2,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 14, 5 + Math.random() * 10, (Math.random() - 0.5) * 14).addScaledVector(normal, 18 + Math.random() * 12),
      });
    }
    for (let i = 0; i < 3; i++) {
      const shade = 0.42 + Math.random() * 0.2;
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(shade, shade * 0.97, shade * 0.9), transparent: true, toneMapped: false }),
      );
      chip.position.copy(position).addScaledVector(normal, 0.5);
      this.scene.add(chip);
      particles.push({
        mesh: chip,
        fade: 0.5,
        life: 0.35 + Math.random() * 0.25,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 50, Math.random() * 45, (Math.random() - 0.5) * 50).addScaledVector(normal, 30 + Math.random() * 30),
      });
    }
  }

  strike(hit, ray, particles) {
    if (!hit?.position) return;
    const normal = hitNormal(hit, ray, normalFromHit).clone();
    this.addHole(hit.position, normal);
    this.puffs(hit.position, normal, particles);
  }

  dust(hit, ray, particles) {
    if (!hit?.position) return;
    this.puffs(hit.position, hitNormal(hit, ray, normalFromHit).clone(), particles);
  }

  clear() {
    for (const mesh of this.holes) if (mesh) mesh.visible = false;
    this.next = 0;
  }

  dispose() {
    this.disposed = true;
    for (const texture of this.realHoles) texture?.dispose();
    this.realHoles.length = 0;
    for (const mesh of this.holes) mesh?.removeFromParent();
    this.holes.length = 0;
    this.holeGeometry.dispose();
    for (const material of this.holeMaterials) material.dispose();
    for (const texture of this.holeTextures) texture.dispose();
    this.dustTexture.dispose();
  }
}

export function fadeParticle(p) {
  if (p.fade && p.mesh.material) p.mesh.material.opacity = Math.max(0, Math.min(1, p.life / p.fade)) * (p.alpha ?? 1);
}

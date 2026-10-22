import * as THREE from 'three';
import { loadAtlas, randomFrame } from './fx-atlas.js';

const MAX_HOLES = 64;
const SURFACE_LIFT = 0.12;
const DUST_ATLAS = 'textures/fxt_smk_puff.png';
const DUST_ALPHA = 0.55;
const WALL_CELL = 96;

export const SURFACES = {
  generic: { size: 4.2, files: ['~-gbullethole1.png', '~-gbullethole2.png'], dust: 0xb9b2a4, chip: [0.5, 0.48, 0.44], puffs: 2, chips: 3 },
  concrete: { size: 5.4, files: ['~-gimpact_concrete01_col#0.png', '~-gimpact_concrete02_col#0.png'], dust: 0xaaa69e, chip: [0.5, 0.49, 0.47], puffs: 2, chips: 4 },
  plaster: { size: 5.4, files: ['~-gimpact_plaster01_col#0.png', '~-gimpact_plaster02_col#0.png'], dust: 0xd2cabb, chip: [0.68, 0.64, 0.57], puffs: 3, chips: 4 },
  wood: { size: 5, files: ['~-gimpact_wood01_col.png', '~-gimpact_wood02_col#0.png', '~-gimpact_wood03_col#0.png'], dust: 0x9a7b55, chip: [0.45, 0.31, 0.18], puffs: 1, chips: 5 },
  metal: { size: 3.6, files: ['~-gimpact_metal02_col.png', '~-gimpact_metal03_col.png'], dust: 0xc8c8c4, chip: [0.78, 0.74, 0.62], puffs: 1, chips: 3 },
  asphalt: { size: 5, files: ['~-gimpact_asphalt01_col#0.png', '~-gimpact_asphalt02_col#0.png'], dust: 0x8f8c86, chip: [0.36, 0.35, 0.34], puffs: 2, chips: 4 },
  glass: { size: 7, files: ['~-gimpact_glass01_col.png', '~-gimpact_glass02_col.png'], dust: 0xdfe6e8, chip: [0.82, 0.88, 0.9], puffs: 0, chips: 5 },
};

export function surfaceTextureUrl(file) {
  return `textures/${file.replace(/#/g, '%23')}`;
}

export function classifySurface(hit, normal) {
  if (hit?.surface && SURFACES[hit.surface]) return hit.surface;
  if (hit?.dynamic) return 'wood';
  if (!normal) return 'generic';
  if (Math.abs(normal.y) > 0.7) {
    const p = hit?.position;
    if (!p) return 'concrete';
    return ((Math.floor(p.x / WALL_CELL) + Math.floor(p.z / WALL_CELL)) & 1) ? 'asphalt' : 'concrete';
  }
  const p = hit?.position;
  if (!p) return 'plaster';
  const cell = Math.floor((p.x + p.z) / WALL_CELL) + Math.floor(p.y / (WALL_CELL * 1.5));
  return (cell & 1) ? 'concrete' : 'plaster';
}

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
    this.fallbackTextures = [
      canvasTexture((ctx, size) => drawHole(ctx, size, [[0.2, 22], [1.4, 18], [2.6, 24], [3.9, 16], [5.1, 20]])),
      canvasTexture((ctx, size) => drawHole(ctx, size, [[0.7, 17], [2.1, 23], [3.3, 19], [4.6, 25]])),
    ];
    this.dustTexture = canvasTexture(drawDust);
    this.holeGeometry = new THREE.PlaneGeometry(1, 1);
    this.materials = new Map();
    this.realTextures = new Map();
    this.holes = [];
    this.next = 0;
    this.disposed = false;
    this.dustAtlas = loadAtlas(DUST_ATLAS, 2);
    this.loader = typeof document === 'undefined' ? null : new THREE.TextureLoader();
  }

  materialFor(surface, variant) {
    const config = SURFACES[surface] ?? SURFACES.generic;
    const file = config.files[variant % config.files.length];
    let material = this.materials.get(file);
    if (material) return material;
    material = new THREE.MeshBasicMaterial({
      map: this.fallbackTextures[variant % this.fallbackTextures.length],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    this.materials.set(file, material);
    this.loadDecal(file, material);
    return material;
  }

  loadDecal(file, material) {
    if (!this.loader) return;
    this.loader.load(surfaceTextureUrl(file), texture => {
      if (this.disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      this.realTextures.set(file, texture);
      material.map = texture;
      material.needsUpdate = true;
    }, undefined, () => {});
  }

  addHole(position, normal, surface = 'generic') {
    const config = SURFACES[surface] ?? SURFACES.generic;
    let mesh = this.holes[this.next];
    if (!mesh) {
      mesh = new THREE.Mesh(this.holeGeometry, null);
      mesh.matrixAutoUpdate = true;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.holes[this.next] = mesh;
    }
    this.next = (this.next + 1) % MAX_HOLES;
    mesh.material = this.materialFor(surface, Math.floor(Math.random() * config.files.length));
    const size = config.size * (0.9 + Math.random() * 0.25);
    mesh.scale.set(size, size, 1);
    mesh.position.copy(position).addScaledVector(normal, SURFACE_LIFT);
    lookTarget.copy(mesh.position).add(normal);
    mesh.lookAt(lookTarget);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.visible = true;
    return mesh;
  }

  puffs(position, normal, particles, surface = 'generic') {
    const config = SURFACES[surface] ?? SURFACES.generic;
    for (let i = 0; i < config.puffs; i++) {
      const frame = randomFrame(this.dustAtlas);
      const material = new THREE.SpriteMaterial({ map: frame ?? this.dustTexture, color: frame ? config.dust : 0xffffff, transparent: true, depthWrite: false, opacity: 0.7, toneMapped: false });
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
    const [r, g, b] = config.chip;
    for (let i = 0; i < config.chips; i++) {
      const shade = 0.82 + Math.random() * 0.36;
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(Math.min(1, r * shade), Math.min(1, g * shade), Math.min(1, b * shade)), transparent: true, toneMapped: false }),
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
    const surface = classifySurface(hit, normal);
    this.addHole(hit.position, normal, surface);
    this.puffs(hit.position, normal, particles, surface);
  }

  dust(hit, ray, particles) {
    if (!hit?.position) return;
    const normal = hitNormal(hit, ray, normalFromHit).clone();
    this.puffs(hit.position, normal, particles, classifySurface(hit, normal));
  }

  clear() {
    for (const mesh of this.holes) if (mesh) mesh.visible = false;
    this.next = 0;
  }

  dispose() {
    this.disposed = true;
    for (const texture of this.realTextures.values()) texture.dispose();
    this.realTextures.clear();
    for (const mesh of this.holes) mesh?.removeFromParent();
    this.holes.length = 0;
    this.holeGeometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    for (const texture of this.fallbackTextures) texture.dispose();
    this.dustTexture.dispose();
  }
}

export function fadeParticle(p) {
  if (p.fade && p.mesh.material) p.mesh.material.opacity = Math.max(0, Math.min(1, p.life / p.fade)) * (p.alpha ?? 1);
}

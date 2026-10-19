// Remote player stand-ins. There are no player character models in the game, so every other player is a coloured
// diamond (an elongated octahedron) with a nose marking where they look and their name tag floating above.
import * as THREE from 'three';
import { colorFor } from './coop.js';

const HEIGHT = 76;           // roughly the player capsule (70) plus a little
const TAG_HEIGHT = 96;
const DOWNED_COLOR = '#6b6b6b';

export function makeNameTag(name, color) {
  if (typeof document === 'undefined') return new THREE.Object3D();
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.Object3D();
  g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.9)'; g.strokeText(name, 128, 34);
  g.fillStyle = color; g.fillText(name, 128, 34);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  sprite.renderOrder = 999;
  sprite.userData.baseScale = [64, 16];
  sprite.scale.set(64, 16, 1);
  return sprite;
}

export function makeDiamond(color) {
  const group = new THREE.Group();
  const geometry = new THREE.OctahedronGeometry(1, 0);
  const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false }));
  body.scale.set(15, HEIGHT / 2 - 2, 15);
  body.position.y = HEIGHT / 2;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, transparent: true, opacity: .85 }));
  edges.scale.copy(body.scale); edges.position.copy(body.position);
  // Looking down -Z at yaw 0 (three.js camera convention), so the nose sits on -Z.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(3.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }));
  nose.position.set(0, HEIGHT * .62, -17);
  group.add(body, edges, nose);
  group.userData.body = body;
  return group;
}

export class RemoteAvatars {
  constructor(scene) { this.scene = scene; this.items = new Map(); }

  /** `samples` come from RemotePlayers.sample(); `roster` decides each player's colour. */
  sync(samples, roster, camera) {
    const seen = new Set();
    for (const s of samples) {
      seen.add(s.id);
      const color = colorFor(roster, s.id), name = s.name || 'Player';
      let item = this.items.get(s.id);
      if (!item || item.color !== color || item.name !== name) {
        if (item) this.remove(s.id);
        item = this.create(s.id, name, color);
      }
      item.group.position.set(s.x, s.y, s.z);
      item.group.rotation.y = s.yaw;
      const downed = s.hp <= 0;
      if (item.downed !== downed) { item.downed = downed; item.body.material.color.set(downed ? DOWNED_COLOR : color); }
      // Keep the tag readable across a big map: grow it with distance, within limits.
      if (camera && item.tag.userData.baseScale) {
        const distance = camera.position.distanceTo(item.group.position), k = Math.min(4, Math.max(1, distance / 500));
        item.tag.scale.set(item.tag.userData.baseScale[0] * k, item.tag.userData.baseScale[1] * k, 1);
      }
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.remove(id);
  }

  create(id, name, color) {
    const group = makeDiamond(color), tag = makeNameTag(name, color);
    tag.position.set(0, TAG_HEIGHT, 0);
    group.add(tag);
    group.name = `remote_player_${id}`;
    group.traverse(o => { o.frustumCulled = false; });
    this.scene.add(group);
    const item = { id, name, color, group, tag, body: group.userData.body, downed: false };
    this.items.set(id, item);
    return item;
  }

  remove(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    item.group.removeFromParent();
    item.group.traverse(o => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
  }

  dispose() { for (const id of [...this.items.keys()]) this.remove(id); }
}

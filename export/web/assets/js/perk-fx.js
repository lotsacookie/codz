import * as THREE from 'three';

const SPARKS = 22;
const LIFE = 0.75;

let puffTexture = null;

function puff() {
  if (puffTexture) return puffTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.35, 'rgba(255,170,60,0.85)');
  grad.addColorStop(1, 'rgba(200,60,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(canvas);
  return puffTexture;
}

export class FlopFx {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  blast(position, radius = 300) {
    const group = new THREE.Group();
    group.position.copy(position);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2;
    group.add(ring);
    const ball = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff(), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    ball.position.y = 30;
    group.add(ball);
    const sparks = [];
    for (let i = 0; i < SPARKS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff(), color: 0xffd080, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.scale.setScalar(5 + Math.random() * 5);
      const a = Math.random() * Math.PI * 2;
      const speed = 160 + Math.random() * 260;
      sprite.position.y = 4;
      group.add(sprite);
      sparks.push({ sprite, vx: Math.cos(a) * speed, vy: 90 + Math.random() * 220, vz: Math.sin(a) * speed });
    }
    const light = new THREE.PointLight(0xff9a40, 8, radius * 1.6, 2);
    light.position.y = 40;
    group.add(light);
    this.scene.add(group);
    this.list.push({ group, ring, ball, sparks, light, age: 0, radius });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.age += dt;
      const t = f.age / LIFE;
      if (t >= 1) {
        this.scene.remove(f.group);
        f.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        f.light.dispose?.();
        this.list.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - Math.min(1, t * 2.2), 3);
      f.ring.scale.setScalar(Math.max(1, f.radius * ease));
      f.ring.material.opacity = (1 - t) * 0.9;
      f.ball.scale.setScalar(60 + ease * 140);
      f.ball.material.opacity = Math.max(0, 1 - t * 1.6);
      f.light.intensity = 8 * (1 - t) * (1 - t);
      for (const s of f.sparks) {
        s.vy -= 520 * dt;
        s.sprite.position.x += s.vx * dt;
        s.sprite.position.y = Math.max(1, s.sprite.position.y + s.vy * dt);
        s.sprite.position.z += s.vz * dt;
        s.sprite.material.opacity = 1 - t;
      }
    }
  }

  clear() {
    for (const f of this.list) {
      this.scene.remove(f.group);
      f.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    this.list.length = 0;
  }
}

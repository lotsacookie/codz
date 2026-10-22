import * as THREE from 'three';

const WOOD = [[0.52, 0.36, 0.2], [0.42, 0.28, 0.15], [0.62, 0.46, 0.28], [0.34, 0.23, 0.12]];
const SHAKE_RANGE = 320;
const SHAKE_GAP = 0.12;

export function boardOutward(barrier, out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  if (barrier?.outside && barrier?.inside) out.subVectors(barrier.outside, barrier.inside);
  out.y = 0;
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  return out.normalize();
}

export function planBoardChips(origin, out, random = Math.random, count = 9) {
  const side = new THREE.Vector3(-out.z, 0, out.x);
  const chips = [];
  for (let i = 0; i < count; i++) {
    const spread = (random() - 0.5) * 2;
    const direction = random() < 0.7 ? 1 : -1;
    const speed = 22 + random() * 46;
    const shade = WOOD[Math.floor(random() * WOOD.length) % WOOD.length];
    const thickness = 0.35 + random() * 0.3;
    chips.push({
      position: origin.clone().addScaledVector(side, spread * 22).add(new THREE.Vector3(0, (random() - 0.5) * 6, 0)),
      velocity: out.clone().multiplyScalar(speed * direction).addScaledVector(side, spread * (14 + random() * 26)).add(new THREE.Vector3(0, 26 + random() * 46, 0)),
      size: [thickness, thickness * 0.8, 1.2 + random() * 2.4],
      color: shade.map(c => Math.min(1, c * (0.85 + random() * 0.3))),
      life: 0.5 + random() * 0.4,
      spin: [random() * Math.PI, random() * Math.PI, random() * Math.PI],
    });
  }
  return chips;
}

export function spawnBoardChips(scene, particles, origin, out, random = Math.random) {
  const chips = planBoardChips(origin, out, random);
  for (const chip of chips) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...chip.size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...chip.color), transparent: true, toneMapped: false }),
    );
    mesh.position.copy(chip.position);
    mesh.rotation.set(...chip.spin);
    scene.add(mesh);
    particles.push({ mesh, fade: 0.35, life: chip.life, velocity: chip.velocity });
  }
  return chips;
}

export function boardLandingShake(state, now, boardPosition, cameraPosition, shake) {
  if (!cameraPosition || boardPosition.distanceTo(cameraPosition) > SHAKE_RANGE) return false;
  if (now - (state.last ?? -Infinity) < SHAKE_GAP) return false;
  state.last = now;
  shake?.();
  return true;
}

export function boardLanded(board, barrier, scene, particles, camera, shakeState, now, shake) {
  const origin = board.getWorldPosition(new THREE.Vector3());
  const out = boardOutward(barrier);
  if (particles) spawnBoardChips(scene, particles, origin, out);
  boardLandingShake(shakeState, now, origin, camera?.position, shake);
}

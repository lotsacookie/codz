import * as THREE from 'three';

const IGNORED = /\bsky\b|sky[_ -]?(box|dome)|\bclouds?\b/i;
const MAX_TRIANGLES = 8000000;
const METERS_TO_UNITS = 39.3701;

const ignored = mesh => IGNORED.test(mesh.name ?? '') || [mesh.material].flat().some(m => IGNORED.test(m?.name ?? ''));

export function flattenObject(root) {
  root.updateWorldMatrix(true, true);
  const jobs = [];
  let vertices = 0, indices = 0;
  root.traverseVisible(object => {
    if (!object.isMesh || !object.geometry?.attributes?.position || ignored(object)) return;
    const geometry = object.geometry;
    const copies = object.isInstancedMesh ? object.count : 1;
    const indexCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    jobs.push({ object, geometry, copies, indexCount });
    vertices += geometry.attributes.position.count * copies;
    indices += indexCount * copies;
  });
  if (indices / 3 > MAX_TRIANGLES) throw new Error(`This model has ${Math.round(indices / 3000000)}M triangles, which is too many to use as a map. Pick a lighter one.`);
  const positions = new Float32Array(vertices * 3), index = new Uint32Array(indices);
  const box = new THREE.Box3();
  const matrix = new THREE.Matrix4(), instance = new THREE.Matrix4(), point = new THREE.Vector3();
  let vertexAt = 0, indexAt = 0;
  for (const { object, geometry, copies, indexCount } of jobs) {
    const attribute = geometry.attributes.position;
    for (let copy = 0; copy < copies; copy++) {
      if (object.isInstancedMesh) {
        object.getMatrixAt(copy, instance);
        matrix.multiplyMatrices(object.matrixWorld, instance);
      } else matrix.copy(object.matrixWorld);
      for (let i = 0; i < attribute.count; i++) {
        point.set(attribute.getX(i), attribute.getY(i), attribute.getZ(i)).applyMatrix4(matrix);
        positions[(vertexAt + i) * 3] = point.x;
        positions[(vertexAt + i) * 3 + 1] = point.y;
        positions[(vertexAt + i) * 3 + 2] = point.z;
        box.expandByPoint(point);
      }
      for (let i = 0; i < indexCount; i++) index[indexAt + i] = vertexAt + (geometry.index ? geometry.index.getX(i) : i);
      vertexAt += attribute.count;
      indexAt += indexCount;
    }
  }
  return { positions, index, box, triangles: indices / 3 };
}

export function fitModel(box, { scale = null, minSpan = 900, maxSpan = 9000 } = {}) {
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 1e-6);
  let factor = scale ?? METERS_TO_UNITS;
  if (scale === null) {
    if (span * factor < minSpan) factor = minSpan / span;
    else if (span * factor > maxSpan) factor = maxSpan / span;
  }
  const center = box.getCenter(new THREE.Vector3());
  return { scale: factor, offset: new THREE.Vector3(-center.x * factor, -box.min.y * factor, -center.z * factor) };
}

export function applyFit(flat, fit) {
  const { positions } = flat;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i] * fit.scale + fit.offset.x;
    positions[i + 1] = positions[i + 1] * fit.scale + fit.offset.y;
    positions[i + 2] = positions[i + 2] * fit.scale + fit.offset.z;
  }
  flat.box = new THREE.Box3(flat.box.min.clone().multiplyScalar(fit.scale).add(fit.offset), flat.box.max.clone().multiplyScalar(fit.scale).add(fit.offset));
  return flat;
}

const CUBE = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];

export function appendBoxes(flat, boxes) {
  const extra = boxes.length * 8;
  const positions = new Float32Array(flat.positions.length + extra * 3);
  const index = new Uint32Array(flat.index.length + boxes.length * 36);
  positions.set(flat.positions);
  index.set(flat.index);
  let vertex = flat.positions.length / 3, at = flat.index.length;
  for (const { min, max } of boxes) {
    const base = vertex;
    for (let corner = 0; corner < 8; corner++) {
      positions[vertex * 3] = corner & 1 ? max.x : min.x;
      positions[vertex * 3 + 1] = corner & 2 ? max.y : min.y;
      positions[vertex * 3 + 2] = corner & 4 ? max.z : min.z;
      vertex++;
    }
    for (const [a, b, c, d] of CUBE) {
      index.set([base + a, base + b, base + c, base + a, base + c, base + d], at);
      at += 6;
    }
  }
  return { positions, index };
}

export function addGround(flat, margin = 800) {
  const { min, max } = flat.box;
  const y = min.y;
  const slab = new THREE.Box3(new THREE.Vector3(min.x - margin, y - 20, min.z - margin), new THREE.Vector3(max.x + margin, y, max.z + margin));
  const merged = appendBoxes(flat, [slab]);
  const box = flat.box.clone().union(slab);
  return { positions: merged.positions, index: merged.index, box, triangles: flat.triangles + 12, ground: slab };
}

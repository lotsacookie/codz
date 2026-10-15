import * as THREE from 'three';

export function positionArray(attribute) {
  if (!attribute.isInterleavedBufferAttribute && !attribute.normalized && attribute.itemSize === 3 && attribute.array instanceof Float32Array) return attribute.array;
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    out[i * 3] = attribute.getX(i);
    out[i * 3 + 1] = attribute.getY(i);
    out[i * 3 + 2] = attribute.getZ(i);
  }
  return out;
}

const _point = new THREE.Vector3();

function splitMesh(mesh, options) {
  const geometry = mesh.geometry;
  const positionAttribute = geometry.attributes.position;
  const positions = positionArray(positionAttribute);
  const indexArray = geometry.index ? geometry.index.array : null;
  const vertexTotal = positionAttribute.count;
  const triangleCount = Math.floor((indexArray ? indexArray.length : vertexTotal) / 3);
  if (triangleCount <= options.minSplit) return null;
  const vertex = (triangle, corner) => (indexArray ? indexArray[triangle * 3 + corner] : triangle * 3 + corner);
  const centroid = new Float32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t++) {
    const a = vertex(t, 0) * 3, b = vertex(t, 1) * 3, c = vertex(t, 2) * 3;
    centroid[t * 3] = (positions[a] + positions[b] + positions[c]) / 3;
    centroid[t * 3 + 1] = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    centroid[t * 3 + 2] = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
  }
  const ids = new Uint32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) ids[i] = i;
  const leaves = [];
  const stack = [0, triangleCount];
  while (stack.length) {
    const hi = stack.pop();
    const lo = stack.pop();
    const count = hi - lo;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let k = lo; k < hi; k++) {
      const t = ids[k] * 3;
      const x = centroid[t], y = centroid[t + 1], z = centroid[t + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const extent = Math.max(dx, dy, dz);
    const small = count <= options.maxTriangles && (extent <= options.maxExtent || count <= options.minSplit);
    if (small || count < 2 || extent < 1e-3) {
      leaves.push(lo, hi);
      continue;
    }
    const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
    const mid = (axis === 0 ? minX + maxX : axis === 1 ? minY + maxY : minZ + maxZ) * 0.5;
    let i = lo, j = hi - 1;
    while (i <= j) {
      if (centroid[ids[i] * 3 + axis] < mid) i++;
      else {
        const swap = ids[i];
        ids[i] = ids[j];
        ids[j] = swap;
        j--;
      }
    }
    if (i === lo || i === hi) {
      leaves.push(lo, hi);
      continue;
    }
    stack.push(lo, i, i, hi);
  }
  if (leaves.length <= 2) return null;

  const IndexType = vertexTotal > 65535 ? Uint32Array : Uint16Array;
  const chunks = [];
  for (let n = 0; n < leaves.length; n += 2) {
    const lo = leaves[n], hi = leaves[n + 1], count = hi - lo;
    const part = ids.slice(lo, hi).sort();
    const index = new IndexType(count * 3);
    const box = new THREE.Box3();
    for (let k = 0; k < count; k++) {
      const t = part[k];
      for (let c = 0; c < 3; c++) {
        const v = vertex(t, c);
        index[k * 3 + c] = v;
        box.expandByPoint(_point.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]));
      }
    }
    const chunkGeometry = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) chunkGeometry.setAttribute(name, geometry.attributes[name]);
    chunkGeometry.setIndex(new THREE.BufferAttribute(index, 1));
    chunkGeometry.boundingBox = box;
    chunkGeometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    chunkGeometry.name = `${geometry.name || mesh.name}_c${chunks.length}`;
    const chunk = new THREE.Mesh(chunkGeometry, mesh.material);
    chunk.name = `${mesh.name}_c${chunks.length}`;
    chunk.userData = mesh.userData;
    chunk.castShadow = mesh.castShadow;
    chunk.receiveShadow = mesh.receiveShadow;
    chunk.renderOrder = mesh.renderOrder;
    chunk.layers.mask = mesh.layers.mask;
    chunk.matrixAutoUpdate = mesh.matrixAutoUpdate;
    chunk.position.copy(mesh.position);
    chunk.quaternion.copy(mesh.quaternion);
    chunk.scale.copy(mesh.scale);
    chunk.updateMatrix();
    chunks.push(chunk);
  }
  return chunks;
}

export function chunkWorldMeshes(root, options = {}) {
  const settings = { maxTriangles: 4000, maxExtent: 1500, minSplit: 2500, ...options };
  root.updateWorldMatrix(true, true);
  const uses = new Map();
  root.traverse((object) => {
    if (object.isMesh && object.geometry) uses.set(object.geometry, (uses.get(object.geometry) ?? 0) + 1);
  });
  const targets = [];
  root.traverseVisible((object) => {
    if (!object.isMesh || object.isSkinnedMesh || object.isInstancedMesh || !object.parent) return;
    if (Array.isArray(object.material) || !object.geometry?.attributes?.position) return;
    if (object.geometry.groups.length > 1 || uses.get(object.geometry) > 1) return;
    targets.push(object);
  });
  let chunkedMeshes = 0;
  let chunks = 0;
  for (const mesh of targets) {
    const pieces = splitMesh(mesh, settings);
    if (!pieces) continue;
    const parent = mesh.parent;
    parent.add(...pieces);
    parent.remove(mesh);
    chunkedMeshes++;
    chunks += pieces.length;
  }
  root.updateWorldMatrix(true, true);
  return { meshes: targets.length, chunkedMeshes, chunks };
}

export default chunkWorldMeshes;

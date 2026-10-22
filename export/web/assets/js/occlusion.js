import * as THREE from 'three';
import { positionArray } from './world-chunks.js';

const NEAR_MARGIN = 1.02;
const GRID = 64;
const CANDIDATE_RATIO = 0.0625;

const _view = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _instance = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _box = new THREE.Box3();

const candidateCache = new WeakMap();

function isOpaque(material) {
  return !!material && !Array.isArray(material) && !material.transparent && material.opacity >= 1 && !(material.alphaTest > 0) &&
    material.visible !== false && material.colorWrite !== false && material.depthWrite !== false && !material.alphaMap && !material.alphaToCoverage;
}

function matrixScale(matrix) {
  const e = matrix.elements;
  return Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
}

function candidateTriangles(geometry, positions, indexArray, minArea) {
  let ids = candidateCache.get(geometry);
  if (ids) return ids;
  const list = [];
  const count = Math.floor((indexArray ? indexArray.length : positions.length / 3) / 3);
  const threshold = minArea * CANDIDATE_RATIO;
  for (let t = 0; t < count; t++) {
    const a = (indexArray ? indexArray[t * 3] : t * 3) * 3;
    const b = (indexArray ? indexArray[t * 3 + 1] : t * 3 + 1) * 3;
    const c = (indexArray ? indexArray[t * 3 + 2] : t * 3 + 2) * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5 >= threshold) list.push(t);
  }
  ids = Uint32Array.from(list);
  candidateCache.set(geometry, ids);
  return ids;
}

function extractOccluders(object, minArea, maxPerUnit) {
  const geometry = object.geometry;
  const attribute = geometry?.attributes?.position;
  if (!attribute || !isOpaque(object.material)) return null;
  const positions = positionArray(attribute);
  const indexArray = geometry.index ? geometry.index.array : null;
  const candidates = candidateTriangles(geometry, positions, indexArray, minArea);
  if (!candidates.length) return null;
  const instances = object.isInstancedMesh ? object.count : 1;
  const triangles = [];
  const areas = [];
  const corner = new Float64Array(9);
  for (let n = 0; n < instances; n++) {
    if (object.isInstancedMesh) {
      _instance.fromArray(object.instanceMatrix.array, n * 16);
      _world.multiplyMatrices(object.matrixWorld, _instance);
    } else _world.copy(object.matrixWorld);
    const e = _world.elements;
    for (let k = 0; k < candidates.length; k++) {
      const t = candidates[k];
      for (let c = 0; c < 3; c++) {
        const v = (indexArray ? indexArray[t * 3 + c] : t * 3 + c) * 3;
        const x = positions[v], y = positions[v + 1], z = positions[v + 2];
        corner[c * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        corner[c * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        corner[c * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      const ux = corner[3] - corner[0], uy = corner[4] - corner[1], uz = corner[5] - corner[2];
      const vx = corner[6] - corner[0], vy = corner[7] - corner[1], vz = corner[8] - corner[2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const area = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
      if (area < minArea) continue;
      areas.push(area);
      for (let i = 0; i < 9; i++) triangles.push(corner[i]);
    }
  }
  if (!areas.length) return null;
  const order = Array.from({ length: areas.length }, (_, i) => i).sort((a, b) => areas[b] - areas[a]).slice(0, maxPerUnit);
  const outTriangles = new Float32Array(order.length * 9);
  const outAreas = new Float32Array(order.length);
  order.forEach((source, i) => {
    outAreas[i] = areas[source];
    for (let j = 0; j < 9; j++) outTriangles[i * 9 + j] = triangles[source * 9 + j];
  });
  return { triangles: outTriangles, areas: outAreas };
}

export class OcclusionCuller {
  constructor({
    root,
    lightDirection,
    width = 128,
    height = 72,
    minOccluderArea = 2000,
    maxOccluderTriangles = 20000,
    maxOccludersPerUnit = 128,
    minPixelArea = 4,
    shadows = true,
    occlusion = true,
  }) {
    this.width = width;
    this.height = height;
    this.minPixelArea = minPixelArea;
    this.occlusion = occlusion;
    this.shadows = shadows;
    this.enabled = true;
    this.depthBias = 4;
    this.vp = new Float64Array(16);
    this.hasView = false;
    this.near = 1;
    this.focal = 1;
    this.units = [];
    this.groups = [];
    this.dynamic = new WeakMap();
    this.stats = { units: 0, visible: 0, shadowOnly: 0, culled: 0, occluders: 0, dynamicHidden: 0, ms: 0 };
    this.cameraPosition = new THREE.Vector3();

    const light = lightDirection.clone().normalize();
    const reference = Math.abs(light.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    this.lightW = light;
    this.lightU = reference.clone().cross(light).normalize();
    this.lightV = light.clone().cross(this.lightU).normalize();
    this.shadowDepth = new Float32Array(GRID * GRID);

    this.levels = [new Float32Array(width * height)];
    this.dims = [[width, height]];
    while (this.dims[this.dims.length - 1][0] > 8 && this.dims[this.dims.length - 1][1] > 4) {
      const [w, h] = this.dims[this.dims.length - 1];
      const next = [Math.ceil(w / 2), Math.ceil(h / 2)];
      this.dims.push(next);
      this.levels.push(new Float32Array(next[0] * next[1]));
    }
    this.buffer = this.levels[0];
    this.polyX = new Float64Array(8);
    this.polyY = new Float64Array(8);
    this.polyW = new Float64Array(8);
    this.vertX = new Float64Array(3);
    this.vertY = new Float64Array(3);
    this.vertW = new Float64Array(3);
    this.screenX = new Float64Array(4);
    this.screenY = new Float64Array(4);
    this.screenI = new Float64Array(4);

    this.register(root, minOccluderArea, maxOccludersPerUnit);
    this.limitOccluders(maxOccluderTriangles);
    this.stats.units = this.units.length;
    this.stats.occluders = this.groups.reduce((sum, group) => sum + group.areas.length, 0);
  }

  lightRange(x0, y0, z0, x1, y1, z1, out) {
    const U = this.lightU, V = this.lightV, W = this.lightW;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? x1 : x0, y = c & 2 ? y1 : y0, z = c & 4 ? z1 : z0;
      const u = U.x * x + U.y * y + U.z * z, v = V.x * x + V.y * y + V.z * z, w = W.x * x + W.y * y + W.z * z;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
      if (w < w0) w0 = w;
      if (w > w1) w1 = w;
    }
    out.u0 = u0;
    out.u1 = u1;
    out.v0 = v0;
    out.v1 = v1;
    out.w0 = w0;
    out.w1 = w1;
    return out;
  }

  register(root, minArea, maxPerUnit) {
    root.updateWorldMatrix(true, true);
    const units = this.units;
    root.traverseVisible((object) => {
      if (!object.isMesh || object.isSkinnedMesh || !object.geometry) return;
      let local = null;
      if (object.isInstancedMesh) {
        if (!object.boundingBox) object.computeBoundingBox();
        local = object.boundingBox;
      } else {
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        local = object.geometry.boundingBox;
      }
      if (!local || local.isEmpty()) return;
      _box.copy(local).applyMatrix4(object.matrixWorld);
      const unit = { object, mask: object.layers.mask, main: true, box: _box.clone() };
      this.lightRange(_box.min.x, _box.min.y, _box.min.z, _box.max.x, _box.max.y, _box.max.z, unit);
      units.push(unit);
      const occluders = extractOccluders(object, minArea, maxPerUnit);
      if (occluders) this.groups.push({ box: unit.box, triangles: occluders.triangles, areas: occluders.areas });
    });
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const unit of units) {
      if (unit.u0 < u0) u0 = unit.u0;
      if (unit.u1 > u1) u1 = unit.u1;
      if (unit.v0 < v0) v0 = unit.v0;
      if (unit.v1 > v1) v1 = unit.v1;
    }
    if (!units.length) {
      u0 = v0 = 0;
      u1 = v1 = 1;
    }
    this.gridU0 = u0;
    this.gridV0 = v0;
    this.cellU = Math.max(1e-3, (u1 - u0) / GRID);
    this.cellV = Math.max(1e-3, (v1 - v0) / GRID);
    for (const unit of units) this.assignCells(unit);
  }

  assignCells(range) {
    const clamp = (value) => Math.max(0, Math.min(GRID - 1, value));
    range.c0 = clamp(Math.floor((range.u0 - this.gridU0) / this.cellU) - 1);
    range.c1 = clamp(Math.floor((range.u1 - this.gridU0) / this.cellU) + 1);
    range.r0 = clamp(Math.floor((range.v0 - this.gridV0) / this.cellV) - 1);
    range.r1 = clamp(Math.floor((range.v1 - this.gridV0) / this.cellV) + 1);
    return range;
  }

  limitOccluders(maxTotal) {
    let total = 0;
    for (const group of this.groups) total += group.areas.length;
    if (total <= maxTotal) return;
    const all = new Float32Array(total);
    let n = 0;
    for (const group of this.groups) for (let i = 0; i < group.areas.length; i++) all[n++] = group.areas[i];
    all.sort();
    const threshold = all[total - maxTotal];
    for (const group of this.groups) {
      let keep = 0;
      while (keep < group.areas.length && group.areas[keep] >= threshold) keep++;
      group.areas = group.areas.subarray(0, keep);
      group.triangles = group.triangles.subarray(0, keep * 9);
    }
    this.groups = this.groups.filter((group) => group.areas.length > 0);
  }

  setEnabled(value) {
    this.enabled = !!value;
    if (!this.enabled) {
      for (const unit of this.units) if (unit.mask !== 1) this.applyMask(unit, 1);
      this.hasView = false;
    }
  }

  applyMask(unit, mask) {
    unit.mask = mask;
    unit.object.layers.mask = mask;
  }

  update(camera) {
    if (!this.enabled) return;
    camera.updateMatrixWorld();
    _view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = _view.elements;
    let same = this.hasView && this.near === camera.near;
    if (same) for (let i = 0; i < 16; i++) if (e[i] !== this.vp[i]) { same = false; break; }
    if (same) return;
    const started = performance.now();
    for (let i = 0; i < 16; i++) this.vp[i] = e[i];
    this.near = camera.near;
    this.focal = camera.projectionMatrix.elements[5] * this.height * 0.5;
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    _frustum.setFromProjectionMatrix(_view);
    this.hasView = true;
    this.rasterize();
    this.buildPyramid();

    const units = this.units;
    let visible = 0;
    for (const unit of units) {
      const b = unit.box;
      unit.main = this.testBox(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
      if (unit.main) visible++;
    }
    const depth = this.shadowDepth;
    depth.fill(-Infinity);
    for (const unit of units) {
      if (!unit.main) continue;
      for (let r = unit.r0; r <= unit.r1; r++) {
        const row = r * GRID;
        for (let c = unit.c0; c <= unit.c1; c++) if (unit.w1 > depth[row + c]) depth[row + c] = unit.w1;
      }
    }
    let shadowOnly = 0;
    for (const unit of units) {
      let mask = 1;
      if (!unit.main) {
        if (this.receivesFrom(unit)) shadowOnly++;
        else mask = 0;
      }
      if (unit.mask !== mask) this.applyMask(unit, mask);
    }
    const stats = this.stats;
    stats.visible = visible;
    stats.shadowOnly = shadowOnly;
    stats.culled = units.length - visible - shadowOnly;
    stats.ms = performance.now() - started;
  }

  receivesFrom(range) {
    if (!this.shadows) return false;
    const depth = this.shadowDepth;
    for (let r = range.r0; r <= range.r1; r++) {
      const row = r * GRID;
      for (let c = range.c0; c <= range.c1; c++) if (depth[row + c] > range.w0) return true;
    }
    return false;
  }

  cullDynamic(roots, radius, lift, keepWithin = 0, origin = null) {
    if (!this.enabled || !this.hasView) return;
    const range = {};
    let hidden = 0;
    for (const root of roots) {
      let state = this.dynamic.get(root);
      if (!state) {
        state = { meshes: [], mask: -1 };
        root.traverse((object) => { if (object.isMesh) state.meshes.push(object); });
        this.dynamic.set(root, state);
      }
      const p = root.position;
      const x0 = p.x - radius, x1 = p.x + radius, y0 = p.y + lift - radius, y1 = p.y + lift + radius, z0 = p.z - radius, z1 = p.z + radius;
      let mask = 1;
      const close = origin && keepWithin > 0 && p.distanceToSquared(origin) < keepWithin * keepWithin;
      if (!close && !this.testBox(x0, y0, z0, x1, y1, z1)) {
        this.lightRange(x0, y0, z0, x1, y1, z1, range);
        this.assignCells(range);
        if (!this.receivesFrom(range)) mask = 0;
      }
      if (mask === 0) hidden++;
      if (state.mask !== mask) {
        state.mask = mask;
        for (const mesh of state.meshes) mesh.layers.mask = mask;
      }
    }
    this.stats.dynamicHidden = hidden;
  }

  testBox(x0, y0, z0, x1, y1, z1) {
    const vp = this.vp;
    const width = this.width, height = this.height;
    const limit = this.near * NEAR_MARGIN;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, nearest = Infinity;
    let behind = 0;
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? x1 : x0, y = c & 2 ? y1 : y0, z = c & 4 ? z1 : z0;
      const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (w <= limit) {
        behind++;
        continue;
      }
      const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w * 0.5 + 0.5) * width;
      const sy = (0.5 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w * 0.5) * height;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
      if (w < nearest) nearest = w;
    }
    if (behind === 8) return false;
    if (behind > 0) return true;
    if (maxX < 0 || minX > width || maxY < 0 || minY > height) return false;
    if (!this.occlusion) return true;
    const ix0 = Math.max(0, Math.floor(minX) - 1), ix1 = Math.min(width - 1, Math.floor(maxX) + 1);
    const iy0 = Math.max(0, Math.floor(minY) - 1), iy1 = Math.min(height - 1, Math.floor(maxY) + 1);
    const threshold = 1 / Math.max(1e-3, nearest - this.depthBias - nearest * 0.002);
    return !this.occluded(ix0, iy0, ix1, iy1, threshold);
  }

  occluded(x0, y0, x1, y1, threshold) {
    const last = this.levels.length - 1;
    let level = 0;
    while (level < last && ((x1 >> level) - (x0 >> level) > 1 || (y1 >> level) - (y0 >> level) > 1)) level++;
    const data = this.levels[level];
    const stride = this.dims[level][0];
    for (let y = y0 >> level; y <= y1 >> level; y++) {
      const row = y * stride;
      for (let x = x0 >> level; x <= x1 >> level; x++) if (data[row + x] <= threshold) return false;
    }
    return true;
  }

  buildPyramid() {
    for (let l = 1; l < this.levels.length; l++) {
      const src = this.levels[l - 1], dst = this.levels[l];
      const [sw, sh] = this.dims[l - 1], [dw, dh] = this.dims[l];
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          let m = Infinity;
          for (let dy = 0; dy < 2; dy++) {
            const sy = y * 2 + dy;
            if (sy >= sh) continue;
            for (let dx = 0; dx < 2; dx++) {
              const sx = x * 2 + dx;
              if (sx >= sw) continue;
              const v = src[sy * sw + sx];
              if (v < m) m = v;
            }
          }
          dst[y * dw + x] = m;
        }
      }
    }
  }

  rasterize() {
    this.buffer.fill(0);
    if (!this.occlusion) return;
    const f2 = this.focal * this.focal;
    const position = this.cameraPosition;
    for (const group of this.groups) {
      if (!_frustum.intersectsBox(group.box)) continue;
      const distance = Math.max(this.near, group.box.distanceToPoint(position));
      const scale = f2 / (distance * distance);
      const areas = group.areas;
      for (let k = 0; k < areas.length; k++) {
        if (areas[k] * scale < this.minPixelArea) break;
        this.rasterTriangle(group.triangles, k * 9);
      }
    }
  }

  rasterTriangle(t, o) {
    const vp = this.vp, near = this.near;
    const vx = this.vertX, vy = this.vertY, vw = this.vertW;
    for (let k = 0; k < 3; k++) {
      const x = t[o + k * 3], y = t[o + k * 3 + 1], z = t[o + k * 3 + 2];
      vx[k] = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
      vy[k] = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
      vw[k] = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    }
    const px = this.polyX, py = this.polyY, pw = this.polyW;
    let n = 0;
    if (vw[0] >= near && vw[1] >= near && vw[2] >= near) {
      for (let k = 0; k < 3; k++) {
        px[k] = vx[k];
        py[k] = vy[k];
        pw[k] = vw[k];
      }
      n = 3;
    } else if (vw[0] < near && vw[1] < near && vw[2] < near) return;
    else {
      for (let k = 0; k < 3; k++) {
        const a = k, b = (k + 1) % 3;
        const aIn = vw[a] >= near, bIn = vw[b] >= near;
        if (aIn) {
          px[n] = vx[a];
          py[n] = vy[a];
          pw[n] = vw[a];
          n++;
        }
        if (aIn !== bIn) {
          const f = (near - vw[a]) / (vw[b] - vw[a]);
          px[n] = vx[a] + (vx[b] - vx[a]) * f;
          py[n] = vy[a] + (vy[b] - vy[a]) * f;
          pw[n] = near;
          n++;
        }
      }
      if (n < 3) return;
    }
    const sx = this.screenX, sy = this.screenY, si = this.screenI;
    for (let i = 0; i < n; i++) {
      sx[i] = (px[i] / pw[i] * 0.5 + 0.5) * this.width;
      sy[i] = (0.5 - py[i] / pw[i] * 0.5) * this.height;
      si[i] = 1 / pw[i];
    }
    for (let i = 1; i + 1 < n; i++) this.fillTriangle(sx[0], sy[0], si[0], sx[i], sy[i], si[i], sx[i + 1], sy[i + 1], si[i + 1]);
  }

  fillTriangle(x0, y0, i0, x1, y1, i1, x2, y2, i2) {
    const width = this.width, height = this.height, buffer = this.buffer;
    const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    const rowStart = Math.max(0, Math.ceil(minY - 0.5)), rowEnd = Math.min(height - 1, Math.floor(maxY - 0.5));
    if (rowStart > rowEnd) return;
    if (Math.max(x0, x1, x2) < 0 || Math.min(x0, x1, x2) >= width) return;
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det) < 3) return;
    const a = ((i1 - i0) * (y2 - y0) - (i2 - i0) * (y1 - y0)) / det;
    const b = ((x1 - x0) * (i2 - i0) - (x2 - x0) * (i1 - i0)) / det;
    const c = i0 - a * x0 - b * y0 - 0.5 * (Math.abs(a) + Math.abs(b));
    for (let row = rowStart; row <= rowEnd; row++) {
      const cy = row + 0.5;
      let left = Infinity, right = -Infinity;
      if ((y0 <= cy && cy < y1) || (y1 <= cy && cy < y0)) {
        const x = x0 + (cy - y0) * (x1 - x0) / (y1 - y0);
        if (x < left) left = x;
        if (x > right) right = x;
      }
      if ((y1 <= cy && cy < y2) || (y2 <= cy && cy < y1)) {
        const x = x1 + (cy - y1) * (x2 - x1) / (y2 - y1);
        if (x < left) left = x;
        if (x > right) right = x;
      }
      if ((y2 <= cy && cy < y0) || (y0 <= cy && cy < y2)) {
        const x = x2 + (cy - y2) * (x0 - x2) / (y0 - y2);
        if (x < left) left = x;
        if (x > right) right = x;
      }
      if (left > right) continue;
      const from = Math.max(0, Math.ceil(left - 0.5)), to = Math.min(width - 1, Math.floor(right - 0.5));
      if (from > to) continue;
      let value = a * (from + 0.5) + b * cy + c;
      let index = row * width + from;
      for (let x = from; x <= to; x++, index++) {
        if (value > buffer[index]) buffer[index] = value;
        value += a;
      }
    }
  }
}

export default OcclusionCuller;

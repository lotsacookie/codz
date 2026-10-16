import * as THREE from 'three';
import { init, importNavMesh, NavMeshQuery } from '@recast-navigation/core';

export class SurvivalNavigation {
  constructor(base) {
    this.base = base;
    this.disabled = new Set();
  }

  async load() {
    await init();
    const [bin, meta] = await Promise.all([fetch(`${this.base}/navigation.bin`), fetch(`${this.base}/navigation.json`)]);
    if (!bin.ok || !meta.ok) throw new Error('Shangri-La navigation data is missing.');
    this.metadata = await meta.json();
    const { navMesh } = importNavMesh(new Uint8Array(await bin.arrayBuffer()));
    this.navMesh = navMesh;
    this.query = new NavMeshQuery(navMesh, { maxNodes: 8192 });
    this.query.defaultQueryHalfExtents = { x: 60, y: 90, z: 60 };
  }

  closest(p, extents) {
    const r = this.query.findClosestPoint(p, extents ? { halfExtents: extents } : undefined);
    return r.success ? new THREE.Vector3(r.point.x, r.point.y, r.point.z) : null;
  }

  path(a, b) {
    const r = this.query.computePath(a, b);
    return r.success ? r.path.map(p => new THREE.Vector3(p.x, p.y, p.z)) : [];
  }

  setBlockers(boxes) {
    for (const ref of this.disabled) this.navMesh.setPolyFlags(ref, 1);
    this.disabled.clear();
    for (const box of boxes) {
      const center = box.getCenter(new THREE.Vector3());
      const extent = box.getSize(new THREE.Vector3()).multiplyScalar(.5);
      extent.x += 2;
      extent.z += 2;
      for (const ref of this.query.queryPolygons(center, extent).polyRefs ?? []) this.disabled.add(ref);
    }
    for (const ref of this.disabled) this.navMesh.setPolyFlags(ref, 0);
  }

  dispose() {
    try { this.query?.destroy?.(); } catch {}
    try { this.navMesh?.destroy?.(); } catch {}
  }
}

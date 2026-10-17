import * as THREE from 'three';
import { init, importNavMesh, NavMeshQuery } from '@recast-navigation/core';
import { AutoPaths } from './auto-paths.js';

const REACH = 90; // a route "arrives" when it ends this close to the goal
const MAP_RETRY_MS = 20000;
const PATH_WINDOW_MS = 250;
const PATH_BUDGET_MS = 6;
const BACKGROUND_SLICE_MS = 2.5;
const LOADING_SLICE_MS = 12;

// Survival navigation = the baked Recast mesh plus an automatically mapped wall-safe graph.
//
// The baked mesh can be fragmented, partly missing or fail to load. All of that is now found out while the map loads
// (prepare()), not when the first zombie of round 1 tries to reach the player: every barricade is checked for a route
// to the player's spawn, and when the baked mesh does not connect them the level is mapped automatically
// (auto-paths.js). Routes from either source only use edges checked against walls and closed doors.
export class SurvivalNavigation {
  constructor(base) {
    this.base = base;
    this.disabled = new Set();
    this.baked = false;
    this.auto = null;
    this.probe = null;
    this.reachableIds = null;   // barrier ids that can reach the player's spawn right now; null until prepare() ran
    this.health = null;
    this.version = 0;
    this.lastMapAt = -Infinity;
    this.pathWindow = 0;
    this.pathSpent = 0;
    this.perf = { bakedCalls: 0, bakedMs: 0, denied: 0, autoCalls: 0, autoMs: 0 };
  }

  perfSnapshot() {
    const out = Object.fromEntries(Object.entries(this.perf).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    this.perf = { bakedCalls: 0, bakedMs: 0, denied: 0, autoCalls: 0, autoMs: 0 };
    return out;
  }

  async load() {
    this.metadata = { candidates: [] };
    try {
      await init();
      const [bin, meta] = await Promise.all([fetch(`${this.base}/navigation.bin`), fetch(`${this.base}/navigation.json`)]);
      if (!bin.ok || !meta.ok) throw new Error('navigation data is missing');
      this.metadata = { candidates: [], ...await meta.json() };
      const { navMesh } = importNavMesh(new Uint8Array(await bin.arrayBuffer()));
      if (!navMesh) throw new Error('navigation.bin could not be read');
      this.navMesh = navMesh;
      this.query = new NavMeshQuery(navMesh, { maxNodes: 8192 });
      this.query.defaultQueryHalfExtents = { x: 60, y: 90, z: 60 };
      this.baked = true;
    } catch (error) {
      // Not fatal any more: the level is mapped automatically in prepare().
      this.baked = false;
      this.loadError = String(error?.message ?? error);
      console.warn('[navigation] baked mesh unavailable, mapping paths automatically:', this.loadError);
    }
  }

  closest(p, extents) {
    if (this.baked) {
      try {
        const r = this.query.findClosestPoint(p, extents ? { halfExtents: extents } : undefined);
        if (r.success) return new THREE.Vector3(r.point.x, r.point.y, r.point.z);
      } catch { /* fall through to the mapped graph */ }
    }
    return null;
  }

  // Baked-mesh route only. Positions moved along it are snapped back onto the mesh by the caller.
  path(a, b) {
    if (!this.baked) return [];
    const now = performance.now();
    if (now - this.pathWindow > PATH_WINDOW_MS) { this.pathWindow = now; this.pathSpent = 0; }
    if (this.pathSpent > PATH_BUDGET_MS) { this.perf.denied++; return []; }
    const route = this.rawPath(a, b);
    const spent = performance.now() - now;
    this.pathSpent += spent;
    this.perf.bakedCalls++;
    this.perf.bakedMs += spent;
    return route;
  }

  rawPath(a, b) {
    if (!this.baked) return [];
    try {
      const r = this.query.computePath(a, b);
      return r.success ? r.path.map(p => new THREE.Vector3(p.x, p.y, p.z)) : [];
    } catch { return []; }
  }

  // Automatically mapped route; every edge was checked against walls and closed doors.
  autoPath(a, b) {
    if (this.auto?.built) {
      const began = performance.now();
      const route = this.auto.path(a, b);
      this.perf.autoCalls++;
      this.perf.autoMs += performance.now() - began;
      return route;
    }
    this.requestMap();
    return [];
  }

  // Start mapping in the background the first time something needs it.
  requestMap() {
    if (!this.world || this.mapping || this.auto?.built || performance.now() - this.lastMapAt < MAP_RETRY_MS) return;
    this.mapping = this.prepare({ force: true, background: true }).finally(() => { this.mapping = null; });
  }

  stepClear(a, b) { return this.probe ? this.probe.stepClear(a, b) : true; }

  arrives(route, goal) { return route.length > 1 && route.at(-1).distanceTo(goal) < REACH; }

  // Can something standing at `from` reach `goal` by either route?
  canReach(from, goal) {
    if (this.arrives(this.rawPath(from, goal), goal)) return true;
    return this.arrives(this.autoPath(from, goal), goal);
  }

  viable(barriers) {
    if (!this.reachableIds) return barriers;
    return barriers.filter(b => this.reachableIds.has(b.id));
  }

  attach(world, { start, barriers = [], candidates = [], onChange } = {}) {
    this.world = world;
    this.probe = new AutoPaths(world);
    this.start = start instanceof THREE.Vector3 ? start.clone() : new THREE.Vector3(...start);
    this.barriers = barriers;
    this.candidates = candidates;
    this.onChange = onChange;
  }

  // Map and verify before the first round. Returns a report; never throws.
  async prepare({ onStatus = () => {}, force = false, background = false } = {}) {
    try { return await this.evaluate({ onStatus, force, background }); } catch (error) {
      console.error('[navigation] preflight failed', error);
      this.health = { ...(this.health ?? {}), error: String(error?.message ?? error) };
      this.reachableIds ??= new Set(this.barriers.map(b => b.id));
      return this.health;
    }
  }

  async evaluate({ onStatus = () => {}, force = false, background = false } = {}) {
    const began = performance.now();
    const start = this.bakedStart() ?? this.start;
    const bakedResult = new Map();
    const baked = id => {
      if (!bakedResult.has(id)) bakedResult.set(id, this.arrives(this.rawPath(this.barriers.find(b => b.id === id).inside, start), start));
      return bakedResult.get(id);
    };
    const total = this.barriers.length;
    const bakedOk = this.barriers.filter(b => baked(b.id));
    onStatus('Mapping walkable paths…');
    const next = new AutoPaths(this.world);
    const autoStats = await next.build(this.start, { background, sliceMs: background ? BACKGROUND_SLICE_MS : LOADING_SLICE_MS, onProgress: p => onStatus(`Mapping walkable paths… ${p.nodes} points`) });
    this.auto = next;
    this.lastMapAt = performance.now();
    const reachable = new Set();
    for (const b of this.barriers) {
      if (baked(b.id) || (this.auto?.built && this.arrives(this.auto.path(b.inside, this.start), this.start))) reachable.add(b.id);
    }
    // A mesh that can not place the player, or connects nothing, is useless: rely on the mapped graph alone.
    this.reachableIds = reachable;
    this.version++;
    this.health = {
      baked: this.baked, bakedStart: !!this.bakedStart(), loadError: this.loadError ?? null,
      barriers: total, bakedReachable: bakedOk.length, reachable: reachable.size, unreachable: total - reachable.size,
      mapped: !!this.auto?.built, autoStats, ms: Math.round(performance.now() - began),
    };
    console.info('[navigation]', JSON.stringify(this.health));
    this.onChange?.(this.health);
    return this.health;
  }

  bakedStart() { return this.baked ? this.closest(this.start, { x: 120, y: 120, z: 120 }) : null; }

  setBlockers(boxes) {
    const signature = boxes.map(b => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(Math.round).join(',')).join('|');
    const changed = signature !== this.blockerSignature;
    this.blockerSignature = signature;
    if (this.baked) {
      try {
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
      } catch (error) { console.warn('[navigation] could not update door blockers', error); }
    }
    if (changed) this.queueRefresh();
  }

  // A door opened (or the run restarted): areas appear or vanish, so verify and re-map in the background.
  queueRefresh() {
    if (!this.world || !this.reachableIds) return;
    this.dirty = true;
    if (this.refreshing) return;
    this.refreshing = (async () => {
      while (this.dirty) { this.dirty = false; await this.prepare({ background: true }); }
    })().finally(() => { this.refreshing = null; });
  }

  dispose() {
    try { this.query?.destroy?.(); } catch {}
    try { this.navMesh?.destroy?.(); } catch {}
  }
}

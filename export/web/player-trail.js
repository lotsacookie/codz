import * as THREE from 'three';

// Breadcrumb trail of where the player has actually walked. When the navmesh cannot connect an enemy
// to the player (fragmented mesh, unbaked area, closed-door bug), enemies follow these crumbs instead.
const EYE = new THREE.Vector3(0, 30, 0);

export class PlayerTrail {
  constructor({ spacing = 48, max = 800, jump = 320 } = {}) {
    Object.assign(this, { spacing, max, jump });
    this.points = [];
  }

  reset() { this.points.length = 0; }

  record(position) {
    const last = this.points.at(-1);
    if (last) {
      const d = last.distanceTo(position);
      if (d > this.jump) this.points.length = 0; // teleport or respawn: the old route no longer leads here
      else if (d < this.spacing) return;
    }
    this.points.push(position.clone());
    if (this.points.length > this.max) this.points.splice(0, this.points.length - this.max);
  }

  // Path from `from` to `goal` along the trail, or [] when no crumb is in line of sight (never walk through walls).
  route(from, goal, clear, candidates = 40) {
    if (!this.points.length) return [];
    const near = this.points.map((p, i) => ({ i, d: p.distanceToSquared(from) })).sort((a, b) => a.d - b.d).slice(0, candidates);
    const start = from.clone().add(EYE);
    let best = -1;
    for (const c of near) if (c.i > best && clear(start, this.points[c.i].clone().add(EYE))) best = c.i;
    if (best < 0) return [];
    return [...this.points.slice(best).map(p => p.clone()), goal.clone()];
  }
}

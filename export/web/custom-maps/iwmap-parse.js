const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const FACE = new RegExp(`^\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*\\)\\s*\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*\\)\\s*\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*\\)\\s+(\\S+)`);
const KEY = /^"([^"]*)"\s+"([^"]*)"\s*$/;

const NUM = new RegExp(NUMBER, 'g');
const PATCH_START = /^(?:patchDef\w*|curve|terrainDef|mesh)\b/i;

// Reads a Radiant `mesh` (BO3) or `patchDef` (older) block into rows of control points.
export function parsePatch(lines) {
  const rows = [];
  let material = null, row = null, grid = 0, nested = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^(?:contents|toolFlags|guid)\b/i.test(line)) continue;
    const vertex = /^v\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
    if (vertex) {
      const point = [Number(vertex[1]), Number(vertex[2]), Number(vertex[3])];
      if (point.every(Number.isFinite)) (row ?? (row = [])).push(point);
      continue;
    }
    if (line === '(') {
      if (grid === 1 && !row) row = [];
      else if (grid === 1) row = row ?? [];
      else if (grid === 0) grid = 1;
      nested++;
      continue;
    }
    if (line === ')') {
      nested--;
      if (row && row.length) rows.push(row);
      row = null;
      continue;
    }
    // patchDef rows: `( ( x y z u v ) ( x y z u v ) )` on one line, or the whole grid on one line
    if (line.startsWith('(') && /\)\s*\)?\s*$/.test(line)) {
      const groups = line.match(/\(([^()]*)\)/g) ?? [];
      const points = groups.map(g => (g.match(NUM) ?? []).map(Number)).filter(n => n.length >= 3);
      if (points.length && groups.length > 1 && /^\(\s*\(/.test(line)) {
        rows.push(points.map(n => [n[0], n[1], n[2]]));
        continue;
      }
      if (!material && points.length === 1 && points[0].length >= 5 && rows.length === 0 && !row) continue;
      if (points.length) (row ?? (row = [])).push([points[0][0], points[0][1], points[0][2]]);
      continue;
    }
    if (!material && !/^[-+\d.(]/.test(line)) {
      material = line.replace(/^"|"$/g, '').split(/\s+/)[0];
      continue;
    }
  }
  const width = Math.max(0, ...rows.map(r => r.length));
  const valid = rows.filter(r => r.length === width);
  if (!material || valid.length < 2 || width < 2) return null;
  return { material, rows: valid };
}

export function parseIwmap(text) {
  const entities = [];
  let version = null, entity = null, brush = null, depth = 0, patchLines = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (depth === 0 && version === null) {
      const header = /^iwmap\s+(\d+)/i.exec(line);
      if (header) {
        version = Number(header[1]);
        continue;
      }
    }
    if (line === '{') {
      depth++;
      if (depth === 1) entity = { keys: {}, brushes: [], patches: [] };
      else if (depth === 2) brush = { faces: [] };
      continue;
    }
    if (line === '}') {
      if (depth === 3 && patchLines) {
        const patch = parsePatch(patchLines);
        if (patch && entity) entity.patches.push(patch);
        patchLines = null;
      }
      if (depth === 2 && brush) {
        if (brush.faces.length) entity.brushes.push(brush);
        brush = null;
      }
      if (depth === 1 && entity) {
        entities.push(entity);
        entity = null;
      }
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) continue;
    if (depth === 1) {
      const pair = KEY.exec(line);
      if (pair) entity.keys[pair[1]] = pair[2];
      continue;
    }
    if (depth === 2) {
      if (PATCH_START.test(line)) {
        patchLines = [];
        continue;
      }
      const face = FACE.exec(line);
      if (face) {
        const n = face.slice(1, 10).map(Number);
        brush.faces.push({ a: n.slice(0, 3), b: n.slice(3, 6), c: n.slice(6, 9), material: face[10] });
      }
      continue;
    }
    if (depth >= 3 && patchLines) patchLines.push(line);
  }
  if (version === null && !entities.length) throw new Error('This is not a Radiant .map file.');
  return { version, entities };
}

export function parseVector(text, size = 3) {
  const parts = String(text ?? '').trim().split(/\s+/).map(Number);
  return Array.from({ length: size }, (_, i) => (Number.isFinite(parts[i]) ? parts[i] : 0));
}

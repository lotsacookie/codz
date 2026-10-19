const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const FACE = new RegExp(`^\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*\\)\\s*\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*\\)\\s*\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*\\)\\s+(\\S+)`);
const KEY = /^"([^"]*)"\s+"([^"]*)"\s*$/;

export function parseIwmap(text) {
  const entities = [];
  let version = null, entity = null, brush = null, depth = 0, patch = false;
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
      if (depth === 1) entity = { keys: {}, brushes: [] };
      else if (depth === 2) brush = { faces: [] };
      continue;
    }
    if (line === '}') {
      if (depth === 2 && brush && !patch) entity.brushes.push(brush);
      if (depth === 2) {
        brush = null;
        patch = false;
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
    if (depth === 2 && !patch) {
      if (/^(?:patchDef|curve|terrainDef)/i.test(line)) {
        patch = true;
        continue;
      }
      const face = FACE.exec(line);
      if (face) {
        const n = face.slice(1, 10).map(Number);
        brush.faces.push({ a: n.slice(0, 3), b: n.slice(3, 6), c: n.slice(6, 9), material: face[10] });
      }
    }
  }
  if (version === null && !entities.length) throw new Error('This is not a Radiant .map file.');
  return { version, entities };
}

export function parseVector(text, size = 3) {
  const parts = String(text ?? '').trim().split(/\s+/).map(Number);
  return Array.from({ length: size }, (_, i) => (Number.isFinite(parts[i]) ? parts[i] : 0));
}

export const HIDDEN_MATERIAL = /(?:^|[_/])(?:clip|nodraw|caulk|skip|hint|portal|trigger|origin|sky|mantle|lightgrid|nolight|collision|umbra|zone|shadowcaster|shadow_caster|traverse|invisible)(?:[_/]|\d|$)|^ai_|volume|^reflection_probe/i;

// Player clip is what holds the player in the real game: the walls, floors and prop outlines the compiled
// models do not exist for here. It is drawn as a plain shell. AI, physics, bullet, shadow and sky stay hidden.
export const SOLID_CLIP = /^clip(?:_player(?:_full)?|_full)?$/i;
export const isHiddenMaterial = material => !SOLID_CLIP.test(material) && HIDDEN_MATERIAL.test(material);

const EPSILON = 0.05;
const BIG = 65536;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export function planeOf(face) {
  const normal = cross(sub(face.c, face.a), sub(face.b, face.a));
  const length = Math.hypot(...normal);
  if (length < 1e-6) return null;
  const n = scale(normal, 1 / length);
  return { normal: n, distance: dot(n, face.a) };
}

function clip(points, plane) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const dp = dot(plane.normal, p) - plane.distance, dq = dot(plane.normal, q) - plane.distance;
    if (dp <= EPSILON) out.push(p);
    if ((dp < -EPSILON && dq > EPSILON) || (dp > EPSILON && dq < -EPSILON)) {
      const t = dp / (dp - dq);
      out.push(add(p, scale(sub(q, p), t)));
    }
  }
  return out;
}

function baseQuad(plane) {
  const n = plane.normal;
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = cross(helper, n);
  const ul = Math.hypot(...u);
  const uu = scale(u, 1 / ul);
  const v = cross(n, uu);
  const centre = scale(n, plane.distance);
  const corner = (a, b) => add(add(centre, scale(uu, a * BIG)), scale(v, b * BIG));
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}
export function brushPolygons(brush, { all = false } = {}) {
  const planes = brush.faces.map(planeOf);
  const polygons = [];
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    const material = brush.faces[i].material;
    if (!plane || (!all && isHiddenMaterial(material))) continue;
    let duplicate = false;
    for (let j = 0; j < i && !duplicate; j++) {
      const other = planes[j];
      duplicate = other && dot(other.normal, plane.normal) > 0.9999 && Math.abs(other.distance - plane.distance) < 0.01;
    }
    if (duplicate) continue;
    let points = baseQuad(plane);
    for (let j = 0; j < planes.length && points.length >= 3; j++) {
      if (j !== i && planes[j]) points = clip(points, planes[j]);
    }
    if (points.length >= 3) polygons.push({ material, normal: plane.normal, points });
  }
  return polygons;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const bezier2 = (a, b, c, t) => lerp(lerp(a, b, t), lerp(b, c, t), t);

// Radiant curves are quadratic Bezier patches: 3 control points per span, spans share an edge point.
// Grids that are not 2 or odd wide fall back to a straight-edged mesh.
function spans(count) {
  if (count === 2) return { size: 2, step: 1, count: 1 };
  if (count >= 3 && count % 2 === 1) return { size: 3, step: 2, count: (count - 1) / 2 };
  return { size: 2, step: 1, count: count - 1 };
}
const sample = (points, kind, t) => (kind === 3 ? bezier2(points[0], points[1], points[2], t) : lerp(points[0], points[1], t));

export function patchPolygons(patch, { detail = 8, all = false } = {}) {
  if (!all && isHiddenMaterial(patch.material)) return [];
  const { rows } = patch;
  const rowSpans = spans(rows.length), colSpans = spans(rows[0].length);
  const polygons = [];
  const grid = (rowSpan, colSpan) => {
    const rn = rowSpan.size === 3 ? detail : 1, cn = colSpan.size === 3 ? detail : 1;
    const out = [];
    for (let i = 0; i <= rn; i++) {
      const line = [];
      for (let j = 0; j <= cn; j++) {
        const columns = [];
        for (let r = 0; r < rowSpan.size; r++) {
          const source = rows[rowSpan.start + r];
          const control = [];
          for (let c = 0; c < colSpan.size; c++) control.push(source[colSpan.start + c]);
          columns.push(sample(control, colSpan.size, j / cn));
        }
        line.push(sample(columns, rowSpan.size, i / rn));
      }
      out.push(line);
    }
    return out;
  };
  for (let a = 0; a < rowSpans.count; a++) {
    for (let b = 0; b < colSpans.count; b++) {
      const points = grid({ ...rowSpans, start: a * rowSpans.step }, { ...colSpans, start: b * colSpans.step });
      for (let i = 0; i < points.length - 1; i++) {
        for (let j = 0; j < points[i].length - 1; j++) {
          const quad = [points[i][j], points[i][j + 1], points[i + 1][j + 1], points[i + 1][j]];
          const normal = cross(sub(quad[1], quad[0]), sub(quad[3], quad[0]));
          const length = Math.hypot(...normal);
          if (length < 1e-6) continue;
          polygons.push({ material: patch.material, normal: scale(normal, 1 / length), points: quad, double: true });
        }
      }
    }
  }
  return polygons;
}

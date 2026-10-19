export const HIDDEN_MATERIAL = /(?:^|[_/])(?:clip|nodraw|caulk|skip|hint|portal|trigger|origin|sky|mantle|lightgrid|nolight|collision|umbra|zone|shadowcaster|shadow_caster|traverse|invisible)(?:[_/]|\d|$)|^ai_|volume|^reflection_probe/i;

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
    if (!plane || (!all && HIDDEN_MATERIAL.test(material))) continue;
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

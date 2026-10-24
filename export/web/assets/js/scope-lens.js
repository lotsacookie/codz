export const LENS_SHAPE = Object.freeze({ minAlpha: 0.3, inner: 0.12, outer: 0.55 });

export const lensUniforms = {
  uLensAim: { value: 0 },
  uLensAspect: { value: 1 },
  uLensShape: { value: [LENS_SHAPE.minAlpha, LENS_SHAPE.inner, LENS_SHAPE.outer] },
};

const clamp01 = value => Math.min(1, Math.max(0, value));

export function isLensMaterial(material) {
  return !!material && typeof material.name === 'string' && /lens/i.test(material.name);
}

export function lensAlpha(radius, aim = 1, shape = LENS_SHAPE) {
  const { minAlpha, inner, outer } = { ...LENS_SHAPE, ...shape };
  const t = clamp01((radius - inner) / Math.max(1e-6, outer - inner));
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  const open = minAlpha + (1 - minAlpha) * eased;
  return 1 + (open - 1) * clamp01(aim);
}

export function lensRadius(ndcX, ndcY, aspect = 1) {
  return Math.hypot(ndcX * aspect, ndcY);
}

const VERTEX_PARS = 'varying vec2 vLensNdc;';
const VERTEX_WRITE = 'vLensNdc = gl_Position.xy / gl_Position.w;';
const FRAGMENT_PARS = `varying vec2 vLensNdc;
uniform float uLensAim;
uniform float uLensAspect;
uniform vec3 uLensShape;`;
const FRAGMENT_APPLY = `float lensR = length( vec2( vLensNdc.x * uLensAspect, vLensNdc.y ) );
float lensT = clamp( ( lensR - uLensShape.y ) / max( 1e-6, uLensShape.z - uLensShape.y ), 0.0, 1.0 );
lensT = lensT * lensT * lensT * ( lensT * ( lensT * 6.0 - 15.0 ) + 10.0 );
float lensOpen = uLensShape.x + ( 1.0 - uLensShape.x ) * lensT;
diffuseColor.a *= 1.0 + ( lensOpen - 1.0 ) * clamp( uLensAim, 0.0, 1.0 );
#include <opaque_fragment>`;

export function patchLensShader(shader) {
  shader.uniforms.uLensAim = lensUniforms.uLensAim;
  shader.uniforms.uLensAspect = lensUniforms.uLensAspect;
  shader.uniforms.uLensShape = lensUniforms.uLensShape;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_WRITE}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <opaque_fragment>', FRAGMENT_APPLY);
}

export function applyScopeLens(root) {
  let patched = 0;
  root?.traverse?.(object => {
    if (!object.isMesh) return;
    for (const material of [object.material].flat()) {
      if (!isLensMaterial(material) || material.userData?.scopeLens) continue;
      material.userData = { ...material.userData, scopeLens: true };
      material.transparent = true;
      material.depthWrite = false;
      material.onBeforeCompile = patchLensShader;
      material.customProgramCacheKey = () => 'scope-lens';
      material.needsUpdate = true;
      patched++;
    }
  });
  return patched;
}

export function updateScopeLens(aim, aspect) {
  lensUniforms.uLensAim.value = clamp01(aim);
  if (aspect > 0) lensUniforms.uLensAspect.value = aspect;
}

// ---- Sight-through: anything solid on the crosshair line of a scoped gun ----
// Scope bodies, rings and caps are rarely named "lens", so they stay opaque and
// block the view. When aiming a scoped gun a ray is cast along the crosshair;
// every gun material it touches gets a dithered hole around the screen centre.
export const SIGHT_SHAPE = Object.freeze({ minAlpha: 0, inner: 0.1, outer: 0.5 });

export const sightUniforms = {
  uSightShape: { value: [SIGHT_SHAPE.minAlpha, SIGHT_SHAPE.inner, SIGHT_SHAPE.outer] },
};

export function sightAlpha(radius, aim = 1, shape = SIGHT_SHAPE) {
  return lensAlpha(radius, aim, { ...SIGHT_SHAPE, ...shape });
}

const SIGHT_FRAGMENT_PARS = `${FRAGMENT_PARS}
uniform vec3 uSightShape;`;
const SIGHT_FRAGMENT_APPLY = `float sightR = length( vec2( vLensNdc.x * uLensAspect, vLensNdc.y ) );
float sightT = clamp( ( sightR - uSightShape.y ) / max( 1e-6, uSightShape.z - uSightShape.y ), 0.0, 1.0 );
sightT = sightT * sightT * sightT * ( sightT * ( sightT * 6.0 - 15.0 ) + 10.0 );
float sightOpen = uSightShape.x + ( 1.0 - uSightShape.x ) * sightT;
float sightA = 1.0 + ( sightOpen - 1.0 ) * clamp( uLensAim, 0.0, 1.0 );
float sightDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
if ( sightA < sightDither ) discard;
#include <opaque_fragment>`;

export function patchSightShader(shader) {
  shader.uniforms.uLensAim = lensUniforms.uLensAim;
  shader.uniforms.uLensAspect = lensUniforms.uLensAspect;
  shader.uniforms.uSightShape = sightUniforms.uSightShape;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_WRITE}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${SIGHT_FRAGMENT_PARS}`)
    .replace('#include <opaque_fragment>', SIGHT_FRAGMENT_APPLY);
}

// Makes the given materials see-through around the crosshair. Lens materials
// already fade by alpha and are skipped. Returns how many were patched.
export function enableSightThrough(materials) {
  let patched = 0;
  for (const material of materials ?? []) {
    if (!material || material.userData?.scopeLens || material.userData?.scopeSight) continue;
    material.userData = { ...material.userData, scopeSight: true };
    material.onBeforeCompile = patchSightShader;
    material.customProgramCacheKey = () => 'scope-sight';
    material.needsUpdate = true;
    patched++;
  }
  return patched;
}

// Scoped guns: sniper rifles, ACOG/scope ids and the G11's optic.
export function wantsSightThrough(def) {
  return /scope|acog|l96|dragunov|g11|sniper/.test(def?.id ?? '');
}

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

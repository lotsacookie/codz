import test from 'node:test';
import assert from 'node:assert/strict';
import { LENS_SHAPE, isLensMaterial, lensAlpha, lensRadius, applyScopeLens, patchLensShader, updateScopeLens, lensUniforms } from '../export/web/scope-lens.js';

test('lens materials are recognised by name', () => {
  assert.ok(isLensMaterial({ name: 'mc/mtl_weapon_scope_acog_lens' }));
  assert.ok(isLensMaterial({ name: 'mc/mtl_t5_weapon_longscope_lens' }));
  assert.ok(!isLensMaterial({ name: 'mc/mtl_t5_dragunov_scope' }));
  assert.ok(!isLensMaterial(null));
});

test('the lens is see-through at the crosshair but never fully clear', () => {
  const centre = lensAlpha(0, 1);
  assert.ok(Math.abs(centre - LENS_SHAPE.minAlpha) < 1e-9);
  assert.ok(centre > 0.15 && centre < 0.5);
});

test('the lens is fully solid at the outer edge and beyond', () => {
  assert.equal(lensAlpha(LENS_SHAPE.outer, 1), 1);
  assert.equal(lensAlpha(5, 1), 1);
});

test('transparency fades in smoothly with no jump', () => {
  let previous = lensAlpha(0, 1);
  let previousStep = 0;
  for (let r = 0.01; r <= 0.7; r += 0.01) {
    const alpha = lensAlpha(r, 1);
    assert.ok(alpha >= previous - 1e-9, 'alpha never decreases outward');
    assert.ok(alpha - previous < 0.06, 'no hard step');
    previous = alpha;
    previousStep = alpha;
  }
  assert.equal(previousStep, 1);
  const edgeStep = lensAlpha(LENS_SHAPE.outer, 1) - lensAlpha(LENS_SHAPE.outer - 0.01, 1);
  assert.ok(edgeStep < 0.02, 'the curve eases into the solid edge');
});

test('the effect only appears as the gun is aimed', () => {
  assert.equal(lensAlpha(0, 0), 1);
  assert.ok(lensAlpha(0, 0.5) > lensAlpha(0, 1));
  assert.ok(lensAlpha(0, 0.5) < 1);
});

test('radius accounts for the screen aspect ratio', () => {
  assert.equal(lensRadius(0, 0, 2), 0);
  assert.equal(lensRadius(0.5, 0, 2), 1);
  assert.equal(lensRadius(0, 0.5, 2), 0.5);
});

test('shader patch adds the uniforms and hooks both stages', () => {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <opaque_fragment>',
  };
  patchLensShader(shader);
  assert.ok(shader.uniforms.uLensAim && shader.uniforms.uLensAspect && shader.uniforms.uLensShape);
  assert.match(shader.vertexShader, /vLensNdc = gl_Position\.xy \/ gl_Position\.w;/);
  assert.match(shader.fragmentShader, /diffuseColor\.a \*=/);
  assert.match(shader.fragmentShader, /#include <opaque_fragment>/);
});

test('applyScopeLens only touches lens materials, once', () => {
  const lens = { name: 'mc/mtl_weapon_scope_acog_lens', transparent: false, depthWrite: true, userData: {} };
  const body = { name: 'mc/mtl_t5_weapon_g11', transparent: false, depthWrite: true, userData: {} };
  const root = { traverse(fn) { fn({ isMesh: true, material: lens }); fn({ isMesh: true, material: [body, lens] }); fn({ isMesh: false }); } };
  assert.equal(applyScopeLens(root), 1);
  assert.equal(lens.transparent, true);
  assert.equal(lens.depthWrite, false);
  assert.equal(typeof lens.onBeforeCompile, 'function');
  assert.equal(body.transparent, false);
  assert.equal(body.onBeforeCompile, undefined);
  assert.equal(applyScopeLens(root), 0);
});

test('uniform updates clamp aim and ignore a bad aspect', () => {
  updateScopeLens(2, 1.5);
  assert.equal(lensUniforms.uLensAim.value, 1);
  assert.equal(lensUniforms.uLensAspect.value, 1.5);
  updateScopeLens(-1, undefined);
  assert.equal(lensUniforms.uLensAim.value, 0);
  assert.equal(lensUniforms.uLensAspect.value, 1.5);
});

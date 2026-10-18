import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBspScene } from '../export/web/custom-maps/bsp.js';

// A tiny hand-made parsed BSP: one quad per texture. Quake stores a front face clockwise, so the real
// builder reverses it; the plane data says which way each quad faces.
function parsedWith(quads) {
  const vertices = [];
  const faces = [];
  const planes = [];
  const textures = [];
  const texinfo = [];
  quads.forEach((quad, i) => {
    const base = vertices.length / 3;
    vertices.push(...quad.points.flat());
    faces.push({ plane: i, side: quad.side ?? 0, edges: 4, texinfo: i, lightOffset: -1, style: 0, ids: [0, 1, 2, 3].map(k => base + k) });
    planes.push(...quad.normal);
    textures.push({ name: quad.name, width: 16, height: 16, rgba: null });
    texinfo.push({ s: [1, 0, 0, 0], t: [0, 1, 0, 0], texture: i, flags: 0 });
  });
  return {
    entities: [{ classname: 'worldspawn' }],
    vertices: Float32Array.from(vertices), textures, texinfo, faces,
    models: [{ firstFace: 0, faceCount: faces.length, mins: [0, 0, 0], maxs: [1, 1, 1] }],
    planes: Float32Array.from(planes),
    faceVertices: face => face.ids,
    faceLight: () => null,
  };
}

// Quake-space floor quad facing +Z. Clockwise seen from above, as Quake stores it.
const floorClockwise = [[0, 0, 0], [0, 64, 0], [64, 64, 0], [64, 0, 0]];
const floorCounter = [...floorClockwise].reverse();

test('textures whose faces all wind front-out are drawn single sided', () => {
  const { root } = buildBspScene(parsedWith([{ name: 'floor', points: floorClockwise, normal: [0, 0, 1] }]));
  assert.equal(root.children[0].material.side, THREE.FrontSide);
});

test('a flipped plane side is understood', () => {
  const { root } = buildBspScene(parsedWith([{ name: 'ceiling', points: floorCounter, normal: [0, 0, 1], side: 1 }]));
  assert.equal(root.children[0].material.side, THREE.FrontSide);
});

test('faces that disagree with their plane keep both sides', () => {
  const { root } = buildBspScene(parsedWith([{ name: 'odd', points: floorCounter, normal: [0, 0, 1] }]));
  assert.equal(root.children[0].material.side, THREE.DoubleSide);
});

test('masked textures stay double sided', () => {
  const { root } = buildBspScene(parsedWith([{ name: '{fence', points: floorClockwise, normal: [0, 0, 1] }]));
  assert.equal(root.children[0].material.side, THREE.DoubleSide);
});

test('without plane data nothing is changed', () => {
  const parsed = parsedWith([{ name: 'floor', points: floorClockwise, normal: [0, 0, 1] }]);
  delete parsed.planes;
  const { root } = buildBspScene(parsed);
  assert.equal(root.children[0].material.side, THREE.DoubleSide);
});

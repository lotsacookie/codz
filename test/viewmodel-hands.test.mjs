import test from 'node:test';
import assert from 'node:assert/strict';
import { getHands, setHands, cycleHands, handsLabel, handsModelFor } from '../export/web/assets/js/viewmodel-hands.js';

const characters = {
  viewmodel_usa_pow_arms: 'models/viewmodel_usa_pow_arms.glb',
  viewhands_usmc: 'models/viewhands_usmc.glb',
};

test('arms are the default and use the character default model', () => {
  assert.equal(getHands(), 'arms');
  assert.equal(handsLabel(), 'ARMS');
  assert.equal(handsModelFor(characters), undefined);
});

test('gloves select the marine glove model', () => {
  assert.equal(setHands('gloves'), 'gloves');
  assert.equal(handsLabel(), 'GLOVES');
  assert.equal(handsModelFor(characters), 'models/viewhands_usmc.glb');
});

test('gloves fall back to the default hands when the model is missing', () => {
  setHands('gloves');
  assert.equal(handsModelFor({ viewmodel_usa_pow_arms: 'x' }), undefined);
  assert.equal(handsModelFor(undefined), undefined);
});

test('unknown values are ignored and cycling returns to arms', () => {
  setHands('gloves');
  assert.equal(setHands('bogus'), 'gloves');
  assert.equal(cycleHands(), 'arms');
  assert.equal(cycleHands(), 'gloves');
  assert.equal(cycleHands(), 'arms');
});

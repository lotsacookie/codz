import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MysteryBox } from '../export/web/assets/js/mystery-box.js';
import { cleanBoxMessage, packBoxStart } from '../export/web/assets/js/net/box-sync.js';
import { createCoop } from '../export/web/assets/js/net/coop-client.js';

function makeBox({ selfId = null, names = {}, random = () => .5 } = {}) {
  const sent = [], toasts = [], session = { time: 0, points: 1000, effects: {}, inventory: [], monkeysOwned: false, random };
  const world = {
    boxLocations: [{ id: 'b1' }, { id: 'b2' }], activeBox: { id: 'b1' }, openBoxes: new Set(), fireSale: false, updateBox() {},
  };
  const data = { weapons: { ak: {}, m14: {}, mp5: {}, python: {} }, equipment: {} };
  const box = new MysteryBox(new THREE.Scene(), world, data, session, { event() {}, fireSale() {} }, text => toasts.push(text));
  for (const id of Object.keys(data.weapons)) box.models[id] = new THREE.Group();
  for (const id of ['b1', 'b2']) box.boxes.set(id, { id, entity: { id }, lid: { quaternion: new THREE.Quaternion() }, closed: new THREE.Quaternion(), display: new THREE.Group(), glow: { material: { opacity: 0 } }, roll: null, opening: 0, closing: 0, model: null, shown: null });
  if (selfId) box.attachNet({ selfId, send: data => sent.push(data), nameOf: id => names[id] ?? 'Another player' });
  return { box, session, world, sent, toasts, e: { id: 'b1' } };
}

function run(setup, seconds) {
  for (let t = 0; t < seconds; t += .1) { setup.session.time += .1; setup.box.update(.1); }
}

test('box messages are cleaned', () => {
  assert.equal(cleanBoxMessage(null), null);
  assert.equal(cleanBoxMessage({ a: 'start' }), null);
  assert.equal(cleanBoxMessage({ a: 'start', b: 'b1', w: 'ak', p: [] }), null);
  assert.equal(cleanBoxMessage({ a: 'nope', b: 'b1' }), null);
  assert.deepEqual(cleanBoxMessage({ a: 'take', b: 'b1' }), { type: 'take', box: 'b1' });
  const start = cleanBoxMessage(packBoxStart({ box: 'b1', roll: { weapon: 'ak', pool: ['ak', 'm14'], teddy: true, sale: false, dest: 'b2' }, uses: 5 }));
  assert.deepEqual(start, { type: 'start', box: 'b1', weapon: 'ak', pool: ['ak', 'm14'], teddy: true, sale: false, dest: 'b2', uses: 5 });
  assert.equal(cleanBoxMessage({ a: 'start', b: 'b1', w: 'ak', p: ['ak'], u: 'x' }).uses, undefined);
  assert.equal(cleanBoxMessage({ a: 'start', b: 'b1', w: '../x', p: ['<a>'] }).weapon, 'x');
});

test('single player is unchanged: no owner, the buyer takes the gun', () => {
  const s = makeBox();
  assert.equal(s.box.start(s.e), true);
  assert.equal(s.box.at(s.e).owner, undefined);
  run(s, 4.5);
  assert.equal(s.box.at(s.e).ready, true);
  assert.equal(s.box.takeLabel(s.box.at(s.e), 'AK'), 'Take AK');
  const weapon = s.box.take(s.e);
  assert.ok(weapon);
  assert.equal(s.box.at(s.e), null);
});

test('buying the box tells everyone, and only the buyer can take the weapon', () => {
  const buyer = makeBox({ selfId: 'p1', names: { p1: 'Ann', p2: 'Bo' } });
  const other = makeBox({ selfId: 'p2', names: { p1: 'Ann', p2: 'Bo' } });
  assert.equal(buyer.box.start(buyer.e), true);
  assert.equal(buyer.sent.length, 1);
  assert.equal(buyer.sent[0].a, 'start');
  assert.equal(buyer.box.at(buyer.e).owner, 'p1');
  assert.equal(other.box.receiveNet('p1', buyer.sent[0]), true);
  const mirrored = other.box.at(other.e);
  assert.equal(mirrored.owner, 'p1');
  assert.equal(mirrored.weapon, buyer.box.at(buyer.e).weapon);
  assert.deepEqual(mirrored.pool, buyer.box.at(buyer.e).pool);
  assert.equal(other.box.start(other.e), false, 'the box is busy while someone else is choosing');
  run(buyer, 4.5); run(other, 4.5);
  assert.equal(other.box.at(other.e).ready, true);
  assert.equal(other.box.takeLabel(mirrored, 'AK'), "Ann's AK");
  assert.equal(other.box.take(other.e), null, 'cannot take their gun');
  assert.ok(other.toasts.some(t => /Ann/.test(t) && /bought/.test(t)), other.toasts.join('|'));
  assert.ok(other.box.at(other.e), 'the weapon is still waiting for its buyer');
  assert.equal(buyer.box.take(buyer.e), buyer.box.models[mirrored.weapon] ? mirrored.weapon : undefined);
  assert.equal(buyer.sent.at(-1).a, 'take');
  assert.equal(buyer.box.at(buyer.e), null);
  assert.equal(other.box.receiveNet('p3', buyer.sent.at(-1)), false, 'only the buyer\'s take closes it');
  assert.ok(other.box.at(other.e));
  assert.equal(other.box.receiveNet('p1', buyer.sent.at(-1)), true);
  assert.equal(other.box.at(other.e), null);
});

test('the weapon offered to the buyer is never picked up by someone who joins in at the same moment', () => {
  const a = makeBox({ selfId: 'p1' }), b = makeBox({ selfId: 'p2' });
  a.box.start(a.e); b.box.start(b.e);
  assert.equal(a.box.receiveNet('p2', b.sent[0]), false);
  assert.equal(b.box.receiveNet('p1', a.sent[0]), false);
  assert.equal(a.box.at(a.e).owner, 'p1');
  assert.equal(b.box.at(b.e).owner, 'p2');
});

test('a teddy bear moves the box to the same place for everyone and only the buyer is refunded', () => {
  const buyer = makeBox({ selfId: 'p1' }), other = makeBox({ selfId: 'p2' });
  buyer.box.uses = 9;
  assert.equal(buyer.box.start(buyer.e), true);
  assert.equal(buyer.box.at(buyer.e).teddy, true);
  assert.equal(buyer.sent[0].d, 'b2');
  assert.equal(buyer.sent[0].u, 10);
  other.box.receiveNet('p1', buyer.sent[0]);
  assert.equal(other.box.uses, 10, 'the purchase count is shared so the next buyer faces the same odds');
  const before = { buyer: buyer.session.points, other: other.session.points };
  run(buyer, 4.5); run(other, 4.5);
  assert.equal(buyer.session.points, before.buyer + 950);
  assert.equal(other.session.points, before.other, 'a teammate\'s teddy does not pay you');
  assert.equal(buyer.box.take(buyer.e), null);
  run(buyer, 6); run(other, 6);
  assert.equal(buyer.world.activeBox.id, 'b2');
  assert.equal(other.world.activeBox.id, 'b2');
  assert.equal(buyer.box.moves, 1); assert.equal(other.box.moves, 1);
  assert.equal(other.box.uses, 0);
});

test('an offer nobody takes expires for everyone', () => {
  const buyer = makeBox({ selfId: 'p1' }), other = makeBox({ selfId: 'p2' });
  buyer.box.start(buyer.e);
  other.box.receiveNet('p1', buyer.sent[0]);
  run(buyer, 20); run(other, 20);
  assert.equal(buyer.box.at(buyer.e), null);
  assert.equal(other.box.at(other.e), null);
});

test('junk, unknown boxes and unknown weapons from the network are handled safely', () => {
  const s = makeBox({ selfId: 'p2' });
  assert.equal(s.box.receiveNet('p1', 'junk'), false);
  assert.equal(s.box.receiveNet('p1', { a: 'start', b: 'nowhere', w: 'ak', p: ['ak'] }), false);
  assert.equal(s.box.receiveNet('p1', { a: 'start', b: 'b1', w: 'ak', p: ['not_a_gun'] }), false);
  assert.equal(s.box.receiveNet('p1', { a: 'start', b: 'b1', w: 'not_a_gun', p: ['m14', 'ak'] }), true);
  assert.equal(s.box.at(s.e).weapon, 'm14', 'falls back to something this player can show');
  assert.equal(s.box.receiveNet('p1', { a: 'take', b: 'nowhere' }), false);
});

test('co-op attaches the box to the room and ignores strangers', () => {
  const handlers = new Map(), sent = [];
  const lobby = { game: { on: (type, fn) => { handlers.set(type, fn); return () => handlers.delete(type); }, send: (type, data) => { sent.push({ type, data }); return Promise.resolve(); } }, players: () => [{ id: 'me', name: 'Me' }, { id: 'p2', name: 'Bo' }], onChange() {} };
  const coop = createCoop({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), feet: () => new THREE.Vector3(), points: () => 500, config: { lobby, selfId: 'me', roster: lobby.players(), role: 'host' }, doc: null });
  const s = makeBox();
  coop.attachBox(s.box);
  s.box.start(s.e);
  assert.equal(sent.at(-1).type, 'box');
  assert.equal(s.box.at(s.e).owner, 'me');
  s.box.close(s.box.boxes.get('b1'));
  run(s, 1);
  handlers.get('box')({ a: 'start', b: 'b1', w: 'ak', p: ['ak'] }, 'stranger');
  assert.equal(s.box.at(s.e), null);
  handlers.get('box')({ a: 'start', b: 'b1', w: 'ak', p: ['ak'] }, 'p2');
  assert.equal(s.box.at(s.e).owner, 'p2');
  assert.equal(s.box.ownerLabel(s.box.at(s.e)), 'Bo');
  coop.dispose();
  assert.equal(handlers.has('box'), false);
  assert.equal(s.box.net, null);
});

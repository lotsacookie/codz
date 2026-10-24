import assert from 'node:assert/strict';
import { hideWallGunAttachments } from '../export/web/assets/js/wall-gun-attachments.js';
const node = (name, children = []) => ({ name, children, userData: {}, scale: { v: 1, setScalar(n) { this.v = n; } }, traverse(f) { f(this); children.forEach(c => c.traverse(f)); } });
const clip = node('tag_ext_clip'), body = node('body'), grip = node('j_grip_up');
const root = node('root', [body, clip, grip]);
assert.equal(hideWallGunAttachments(root, { hideTags: ['tag_ext_clip', 'j_grip_up', 'j_stock'] }), 2);
assert.ok(clip.scale.v < .001 && grip.scale.v < .001 && body.scale.v === 1);
assert.equal(hideWallGunAttachments(root, {}), 0);
console.log('wall attachments ok');

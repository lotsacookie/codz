// Bakes fx_pistol_shell / fx_shotgun_shell / fx_rifle_shell / fx_bullet_chain reference XModels into compact meshes for shell-eject.js.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
const REF = 'export/web/assets/reference';
// Models sit in a per-zone folder (common_zombie, code_post_gfx, ...), so look for the first zone that has one.
const modelPath = name => [`${REF}/models/${name}.json`, ...readdirSync(REF).map(zone => `${REF}/${zone}/models/${name}.json`)].find(existsSync);
const half = h => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  return e === 0 ? s * f * 2 ** -24 : e === 31 ? 0 : s * (1 + f / 1024) * 2 ** (e - 15); };
export function bake(name) {
  const asset = JSON.parse(readFileSync(modelPath(name), 'utf8')).asset;
  const pos = [], uv = [], idx = [];
  for (const s of asset.surfs) {
    const base = pos.length / 3;
    for (const v of s.verts0) { const [x, y, z] = v.xyz.v; pos.push(x, y, z);
      const p = v.texCoord.packed >>> 0; uv.push(half(p & 0xffff), half(p >>> 16)); }
    for (const t of s.triIndices) idx.push(...t.i.map(i => i + base));
  }
  const r = n => +n.toFixed(5);
  return { pos: pos.map(r), uv: uv.map(r), idx, radius: r(asset.radius) };
}
if (process.argv[1].endsWith('bake-shells.mjs')) {
  const out = { pistol: bake('fx_pistol_shell'), shotgun: bake('fx_shotgun_shell'), rifle: bake('fx_rifle_shell'), chain: bake('fx_bullet_chain') };
  writeFileSync('export/web/assets/data/shell-models.json', JSON.stringify(out));
  for (const [k, m] of Object.entries(out)) console.log(k, m.pos.length / 3, 'verts', m.idx.length / 3, 'tris', 'uv', Math.min(...m.uv), Math.max(...m.uv));
}

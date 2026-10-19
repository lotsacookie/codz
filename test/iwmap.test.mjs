import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIwmap } from '../export/web/custom-maps/iwmap-parse.js';
import { brushPolygons } from '../export/web/custom-maps/iwmap-brush.js';
import { flattenIwmap, createResolver } from '../export/web/custom-maps/iwmap-flatten.js';
import { extractIwmapLayout, playArea, restrictLayout } from '../export/web/custom-maps/iwmap-layout.js';
import { parseGdtMaterials, describeMaterial, packTextureFor, imageIndex, boxUv, createMaterialLibrary } from '../export/web/custom-maps/iwmap-material.js';
import { patchPolygons } from '../export/web/custom-maps/iwmap-brush.js';
import { parseGithubMapUrl, isGithubRepoUrl, fetchPrefabs } from '../export/web/custom-maps/iwmap-remote.js';

const face = (a, b, c, material = 'wall') => ` ( ${a.join(' ')} ) ( ${b.join(' ')} ) ( ${c.join(' ')} ) ${material} 16 16 0 0 0 0 lightmap_gray 16384 16384 0 0 0 0`;

function cube(min, max, material = 'wall') {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  return [
    face([x0, y0, z1], [x1, y1, z1], [x1, y0, z1], material),
    face([x0, y0, z0], [x1, y1, z0], [x0, y1, z0], material),
    face([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], material),
    face([x1, y1, z0], [x1, y1, z1], [x0, y1, z1], material),
    face([x0, y1, z0], [x0, y1, z1], [x0, y0, z1], material),
    face([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], material),
  ].join('\n');
}

const world = brushes => `iwmap 4
"000_Global" flags active
// entity 0
{
guid "{A}"
"classname" "worldspawn"
${brushes.map((b, i) => `// brush ${i}\n{\n guid "{B${i}}"\n${b}\n}`).join('\n')}
}`;

test('parses entities, keys and brush faces and skips patches', () => {
  const text = `${world([cube([0, 0, 0], [64, 64, 64], 'ayz_floor')])}
// entity 1
{
"classname" "script_struct"
"origin" "1 2 3"
"targetname" "zm_perk_machine"
"script_noteworthy" "specialty_armorvest"
{
patchDef3
{
"ayz_floor"
( 3 3 0 0 0 0 0 0 )
(
( ( 0 0 0 0 0 ) ( 1 0 0 0 0 ) ( 2 0 0 0 0 ) )
)
}
}
}`;
  const map = parseIwmap(text);
  assert.equal(map.version, 4);
  assert.equal(map.entities.length, 2);
  assert.equal(map.entities[0].brushes[0].faces.length, 6);
  assert.equal(map.entities[0].brushes[0].faces[0].material, 'ayz_floor');
  assert.equal(map.entities[1].keys.script_noteworthy, 'specialty_armorvest');
  assert.equal(map.entities[1].brushes.length, 0);
  assert.throws(() => parseIwmap('hello'), /Radiant/);
});

test('brush faces point out of the brush and close into a box', () => {
  const map = parseIwmap(world([cube([-32, -16, 0], [32, 16, 48])]));
  const polygons = brushPolygons(map.entities[0].brushes[0]);
  assert.equal(polygons.length, 6);
  const centre = [0, 0, 24];
  for (const polygon of polygons) {
    assert.ok(polygon.points.length >= 4);
    const mean = [0, 1, 2].map(i => polygon.points.reduce((sum, p) => sum + p[i], 0) / polygon.points.length);
    const out = [0, 1, 2].map(i => mean[i] - centre[i]);
    assert.ok(out[0] * polygon.normal[0] + out[1] * polygon.normal[1] + out[2] * polygon.normal[2] > 0);
    const [a, b, c] = polygon.points;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(n[0] * polygon.normal[0] + n[1] * polygon.normal[1] + n[2] * polygon.normal[2] > 0);
  }
  const xs = polygons.flatMap(p => p.points.map(q => q[0]));
  assert.equal(Math.min(...xs), -32);
  assert.equal(Math.max(...xs), 32);
});

test('hidden materials are dropped unless asked for', () => {
  const map = parseIwmap(world([cube([0, 0, 0], [8, 8, 8], 'clip_player_32'), cube([0, 0, 0], [8, 8, 8], 'nodraw'), cube([0, 0, 0], [8, 8, 8], 'ayz_clip_wall')]));
  assert.equal(map.entities[0].brushes.flatMap(b => brushPolygons(b)).length, 0);
  assert.equal(map.entities[0].brushes.flatMap(b => brushPolygons(b, { all: true })).length, 18);
});

test('prefabs are placed, rotated and recursed, and missing ones are reported', () => {
  const prefab = `${world([cube([0, 0, 0], [10, 10, 10], 'prefab_wall')])}
// entity 1
{
"classname" "script_struct"
"origin" "10 0 0"
"script_noteworthy" "specialty_armorvest"
"targetname" "zm_perk_machine"
}`;
  const main = parseIwmap(`${world([cube([0, 0, 0], [4, 4, 4])])}
// entity 1
{
"classname" "misc_prefab"
"model" "_prefabs/zm/perk.map"
"origin" "100 200 0"
"angles" "0 90 0"
}
// entity 2
{
"classname" "misc_prefab"
"model" "_prefabs/zm/missing.map"
}`);
  const flat = flattenIwmap(main, { resolve: createResolver(new Map([['map_source/_prefabs/zm/perk.map', prefab]])) });
  assert.equal(flat.stats.prefabs, 1);
  assert.deepEqual(flat.stats.missingPrefabs, ['_prefabs/zm/missing.map']);
  const placed = flat.polygons.filter(p => p.material === 'prefab_wall').flatMap(p => p.points);
  const xs = placed.map(p => p[0]), ys = placed.map(p => p[1]);
  assert.ok(Math.abs(Math.min(...xs) - 90) < 1e-6 && Math.abs(Math.max(...xs) - 100) < 1e-6);
  assert.ok(Math.abs(Math.min(...ys) - 200) < 1e-6 && Math.abs(Math.max(...ys) - 210) < 1e-6);
  const perk = flat.entities.find(e => e.script_noteworthy === 'specialty_armorvest');
  assert.ok(Math.abs(perk.origin[0] - 100) < 1e-6 && Math.abs(perk.origin[1] - 210) < 1e-6);
  assert.ok(Math.abs(perk.yaw - 90) < 1e-6);
});

test('layout finds the player start, perks, box, Pack-a-Punch, spawners and windows', () => {
  const entities = [
    { classname: 'info_player_start', origin: [9, 9, 9], yaw: 0 },
    { classname: 'script_struct', targetname: 'initial_spawn_points', script_noteworthy: 'initial_spawn', origin: [10, 20, 30], yaw: 45 },
    { classname: 'script_struct', targetname: 'zm_perk_machine', script_noteworthy: 'specialty_doubletap2', origin: [1, 2, 3], yaw: 0 },
    { classname: 'script_struct', targetname: 'zm_perk_machine', script_noteworthy: 'specialty_widowswine', origin: [1, 2, 3], yaw: 0 },
    { classname: 'zbarrier_zmcore_packapunch', origin: [4, 5, 6], yaw: 0 },
    { classname: 'zbarrier_zmcore_MagicBox', origin: [7, 8, 9], yaw: 0 },
    { classname: 'script_struct', script_noteworthy: 'riser_location', origin: [100, 100, 0] },
    { classname: 'script_struct', script_noteworthy: 'dog_location', origin: [500, 500, 0] },
    { classname: 'script_struct', targetname: 'exterior_goal', origin: [110, 100, 0], yaw: 90 },
    { classname: 'light', origin: [0, 0, 50], _color: '1 0 0', radius: '200' },
  ];
  const layout = extractIwmapLayout(entities);
  assert.deepEqual(layout.spawn, { point: [10, 30, -20], yaw: 45 });
  assert.deepEqual(layout.sites.map(s => s.role), ['specialty_rof', 'pack', 'chest']);
  assert.deepEqual(layout.sites[0].point, [1, 3, -2]);
  assert.equal(layout.spawners.length, 1);
  assert.equal(layout.windows.length, 1);
  assert.deepEqual(layout.windows[0].spawner, [100, 0, -100]);
  assert.deepEqual(layout.lights[0].color, [1, 0, 0]);
  assert.ok(layout.lights[0].intensity >= 90);
});

test('play area crops to the perks and box and moves a far-away intro spawn into it', () => {
  const layout = {
    spawn: { point: [-26000, 11800, 12800], yaw: 0 },
    sites: [{ role: 'chest', point: [0, 0, 0], yaw: 90 }, { role: 'pack', point: [600, 0, -300], yaw: 0 }],
    windows: [{ point: [300, 0, 500], yaw: 0, spawner: null, spawners: [] }],
    spawners: [[100, 0, 100], [30000, 0, 0]],
    lights: [{ point: [200, 50, 0], color: [1, 1, 1], intensity: 100 }, { point: [-26000, 11800, 12800], color: [1, 1, 1], intensity: 100 }],
    doors: [], walls: [], environment: {},
  };
  const area = playArea(layout);
  assert.equal(area.relocated, true);
  assert.ok(area.min[0] < 0 && area.max[0] > 600);
  const cropped = restrictLayout(layout, area);
  assert.equal(cropped.spawners.length, 1);
  assert.equal(cropped.lights.length, 1);
  assert.ok(cropped.spawn.point[1] < 100 && Math.abs(cropped.spawn.point[0]) < 1000);
  const near = playArea({ ...layout, spawn: { point: [200, 0, 200], yaw: 0 } });
  assert.equal(near.relocated, false);
  assert.equal(playArea({ ...layout, sites: [], windows: [] }), null);
});

const MESH = `iwmap 4
// entity 0
{
"classname" "worldspawn"
// brush 0
 {
  guid "{M}"
  mesh
  {
  contents nonColliding;
  toolFlags;
   ayz_wall
   lightmap_gray
   3 3 0 8
   (
\tv 0 0 0 t 0 0 0 0
\tv 64 0 32 t 1 0 0 0
\tv 128 0 0 t 2 0 0 0
   )
   (
\tv 0 64 0 t 0 1 0 0
\tv 64 64 32 t 1 1 0 0
\tv 128 64 0 t 2 1 0 0
   )
   (
\tv 0 128 0 t 0 2 0 0
\tv 64 128 32 t 1 2 0 0
\tv 128 128 0 t 2 2 0 0
   )
  }
 }
}`;

test('reads BO3 mesh blocks as control point grids', () => {
  const map = parseIwmap(MESH);
  const world = map.entities[0];
  assert.equal(world.brushes.length, 0);
  assert.equal(world.patches.length, 1);
  assert.equal(world.patches[0].material, 'ayz_wall');
  assert.equal(world.patches[0].rows.length, 3);
  assert.deepEqual(world.patches[0].rows[1][1], [64, 64, 32]);
});

test('reads patchDef grids and keeps brushes next to them', () => {
  const text = `${world([cube([0, 0, 0], [64, 64, 64], 'ayz_floor')])}`.replace(/}$/, `{
patchDef3
{
"ayz_floor"
( 3 3 0 0 0 0 0 0 )
(
( ( 0 0 0 0 0 ) ( 1 0 1 0 0 ) ( 2 0 0 0 0 ) )
( ( 0 1 0 0 0 ) ( 1 1 1 0 0 ) ( 2 1 0 0 0 ) )
( ( 0 2 0 0 0 ) ( 1 2 1 0 0 ) ( 2 2 0 0 0 ) )
)
}
}
}`);
  const entity = parseIwmap(text).entities[0];
  assert.equal(entity.brushes.length, 1);
  assert.equal(entity.patches.length, 1);
  assert.equal(entity.patches[0].rows[2][2][0], 2);
});

test('3x3 patches bend smoothly while 2x2 patches stay flat', () => {
  const curved = parseIwmap(MESH).entities[0].patches[0];
  const polygons = patchPolygons(curved, { detail: 4 });
  assert.equal(polygons.length, 16);
  const tops = polygons.flatMap(p => p.points).map(p => p[2]);
  assert.ok(Math.max(...tops) > 15 && Math.max(...tops) < 32, 'the bezier surface peaks below the control point');
  const finer = patchPolygons(curved, { detail: 8 }).flatMap(p => p.points).map(p => Math.round(p[2] * 100));
  assert.ok(new Set(finer).size > 4, 'more than a few distinct heights means a real curve');
  const flat = patchPolygons({ material: 'ayz_floor', rows: [[[0, 0, 0], [8, 0, 0]], [[0, 8, 0], [8, 8, 0]]] });
  assert.equal(flat.length, 1);
  assert.deepEqual(patchPolygons({ material: 'clip_ai', rows: curved.rows }), []);
});

test('curved geometry flattens with its prefab transform', () => {
  const main = parseIwmap(`${MESH}
// entity 1
{
"classname" "misc_prefab"
"model" "_prefabs/curve.map"
"origin" "1000 0 0"
"angles" "0 0 0"
}`);
  const resolve = () => parseIwmap(MESH);
  const flat = flattenIwmap(main, { resolve });
  assert.equal(flat.stats.patches, 2);
  const xs = flat.polygons.flatMap(p => p.points.map(q => q[0]));
  assert.ok(Math.max(...xs) >= 1128);
});

test('a missing stock prefab still marks its barricade, wall buy and box', () => {
  const entity = (model, at) => `{\n"classname" "misc_prefab"\n"model" "${model}"\n"origin" "${at}"\n"angles" "0 90 0"\n}`;
  const text = `iwmap 4\n{\n"classname" "worldspawn"\n}\n${entity('_prefabs/zm/zm_core/barricade_reciever_wood.map', '100 0 0')}\n${entity('_prefabs/zm/zm_core/spawnable_weapon_shotgun_pump.map', '0 200 0')}\n${entity('_prefabs/zm/zm_giant/geo/zm_giant_magicbox_platform.map', '5 5 5')}`;
  const flat = flattenIwmap(parseIwmap(text), { resolve: () => null });
  const layout = extractIwmapLayout(flat.entities);
  assert.equal(layout.windows.length, 1);
  assert.equal(layout.walls.length, 1);
  assert.equal(layout.sites.length, 0, 'a platform is level geometry, not a box location');
  assert.equal(Math.round(layout.windows[0].yaw), 90);
});

test('box locations come from treasure chest structs and the same spot is counted once', () => {
  const layout = extractIwmapLayout([
    { classname: 'zbarrier_zmcore_MagicBox', origin: [10, 20, 0], yaw: 0 },
    { classname: 'script_struct', targetname: 'treasure_chest_use', origin: [12, 20, 0], yaw: 0 },
    { classname: 'script_struct', targetname: 'treasure_chest_use', origin: [900, 900, 0], yaw: 0 },
    { classname: 'script_struct', script_noteworthy: 'riser_location', targetname: 'start_zone_spawners', origin: [0, 0, 0] },
    { classname: 'script_struct', script_noteworthy: 'dog_location', origin: [5, 5, 0] },
  ]);
  assert.equal(layout.sites.filter(s => s.role === 'chest').length, 2);
  assert.equal(layout.spawners.length, 1);
});

test('spawners that sit near the perks widen the play area; distant sections are left out', () => {
  const layout = {
    spawn: { point: [0, 0, 0], yaw: 0 },
    sites: [{ role: 'pack', point: [0, 0, 0] }],
    windows: [], walls: [], doors: [], lights: [],
    spawners: [[4000, 0, 0], [40000, 0, 0]],
  };
  const area = playArea(layout);
  assert.ok(area.max[0] >= 7000 && area.max[0] < 10000);
});

test('GitHub links resolve to a repository or a single map file', () => {
  assert.deepEqual(parseGithubMapUrl('https://github.com/MattFiler/zm_alien_isolation'), { owner: 'MattFiler', repo: 'zm_alien_isolation', ref: null, path: null });
  assert.equal(isGithubRepoUrl('https://github.com/MattFiler/zm_alien_isolation/'), true);
  const file = parseGithubMapUrl('https://github.com/a/b/blob/main/map_source/zm/x.map');
  assert.deepEqual(file, { owner: 'a', repo: 'b', ref: 'main', path: 'map_source/zm/x.map' });
  assert.equal(isGithubRepoUrl('https://github.com/a/b/blob/main/map_source/zm/x.map'), false);
  assert.equal(parseGithubMapUrl('https://example.com/x.map'), null);
});

test('prefabs are fetched recursively and a 404 is skipped', async () => {
  const prefab = (...models) => `iwmap 4\n${models.map(m => `{\n"classname" "misc_prefab"\n"model" "${m}"\n}`).join('\n')}`;
  const store = { '_prefabs/a.map': prefab('_prefabs/b.map', '_prefabs/zm/stock.map'), '_prefabs/b.map': prefab() };
  const asked = [];
  const fetchImpl = async url => {
    asked.push(url);
    const body = store[url.replace('https://x/', '')];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body ?? '' };
  };
  const files = await fetchPrefabs(prefab('_prefabs/a.map'), name => `https://x/${name}`, { fetchImpl });
  assert.deepEqual([...files.keys()].sort(), ['_prefabs/a.map', '_prefabs/b.map']);
  assert.ok(asked.includes('https://x/_prefabs/zm/stock.map'));
});

test('player clip is drawn as a shell while AI, physics and shadow clip stay hidden', () => {
  const text = world([cube([0, 0, 0], [64, 64, 64], 'clip_player'), cube([100, 0, 0], [164, 64, 64], 'clip'), cube([200, 0, 0], [264, 64, 64], 'clip_ai'), cube([300, 0, 0], [364, 64, 64], 'clip_physics'), cube([400, 0, 0], [464, 64, 64], 'caulk_shadow')]);
  const flat = flattenIwmap(parseIwmap(text));
  assert.equal(flat.polygons.length, 12);
  assert.deepEqual([...new Set(flat.polygons.map(p => p.material))].sort(), ['clip', 'clip_player']);
});

test('buyable doors and debris take the brushes of the entity their trigger names', () => {
  const text = `${world([cube([0, 0, 0], [8, 8, 8])])}
// entity 1
{
"classname" "script_brushmodel"
"targetname" "noodlebar_door"
// brush 0
{
${cube([100, 0, 0], [140, 20, 96], 'clip')}
}
}
// entity 2
{
"classname" "trigger_use"
"targetname" "zombie_door"
"target" "noodlebar_door"
"zombie_cost" "950"
}
// entity 3
{
"classname" "trigger_use"
"targetname" "zombie_debris"
"target" "nothing_here"
}`;
  const flat = flattenIwmap(parseIwmap(text));
  const layout = extractIwmapLayout(flat.entities, flat.brushModels);
  assert.equal(layout.doors.length, 1);
  assert.equal(layout.doors[0].cost, 950);
  assert.deepEqual(layout.doors[0].min.map(v => v + 0), [100, 0, -20]);
  assert.deepEqual(layout.doors[0].max.map(v => v + 0), [140, 96, 0]);
});

const GDT = `{
\t"dark_grey_floortile" ( "material.gdf" )
\t{
\t\t"colorMap" "dark_grey_floortile_c_new"
\t\t"colorTint" "0.380392 0.380392 0.380392 1"
\t\t"surfaceType" "plaster"
\t\t"materialType" "lit_plus"
\t\t"cg00_x" "0"
\t}
\t"ayz_glass" ( "material.gdf" )
\t{
\t\t"colorMap" "ayz_glass"
\t\t"surfaceType" "glass"
\t\t"materialType" "lit_transparent"
\t}
}`;

test('material definitions come out of .gdt files, only for the materials the map uses', () => {
  const all = parseGdtMaterials(GDT);
  assert.equal(all.size, 2);
  assert.equal(all.get('dark_grey_floortile').colorMap, 'dark_grey_floortile_c_new');
  assert.equal(all.get('dark_grey_floortile').cg00_x, undefined);
  assert.equal(parseGdtMaterials(GDT, new Set(['ayz_glass'])).size, 1);
});

test('materials are classed by surface type and name, with the GDT tint applied', () => {
  const tile = describeMaterial('dark_grey_floortile', parseGdtMaterials(GDT).get('dark_grey_floortile'));
  assert.equal(tile.kind, 'tile');
  assert.ok(Math.abs(tile.tint[0] - 0.38) < 0.01);
  assert.equal(describeMaterial('ayz_glass', parseGdtMaterials(GDT).get('ayz_glass')).transparent, true);
  assert.equal(describeMaterial('elevator_backlit_light').kind, 'light');
  assert.equal(describeMaterial('t7_metal_duct_insulation_01_grey').kind, 'metal');
  assert.equal(describeMaterial('$default').colorMap, null);
});

test('supplied images are found by their colour map name in any folder and format', () => {
  const index = imageIndex(new Map([['maps/images/Dark_Grey_Floortile_C_New.TGA', new Uint8Array(4)], ['x/readme.txt', new Uint8Array(1)], ['a/b.png', new Uint8Array(1)]]));
  assert.ok(index.has('dark_grey_floortile_c_new'));
  assert.ok(index.has('b'));
  assert.equal(index.size, 2);
  const library = createMaterialLibrary({ files: new Map(), gdt: parseGdtMaterials(GDT) });
  const glass = library.get('ayz_glass');
  assert.equal(glass.transparent, true);
  assert.equal(library.get('ayz_glass'), glass, 'a material is built once');
});

test('box projection uses the two axes across the dominant normal', () => {
  assert.deepEqual(boxUv([256, 128, 64], [0, 0, 1]), [2, 1]);
  assert.deepEqual(boxUv([256, 128, 64], [1, 0, 0]), [1, 0.5]);
  assert.deepEqual(boxUv([256, 128, 64], [0, 1, 0]), [2, 0.5]);
});

test('World at War stand-in textures only cover real tile and metal colour maps', () => {
  assert.equal(packTextureFor('dark_grey_floortile', { colorMap: 'dark_grey_floortile_c_new' }, 'tile'), 'tile.webp');
  assert.equal(packTextureFor('tow_floor', { colorMap: 'tow_floor_c' }, 'tile'), 'tile.webp');
  assert.equal(packTextureFor('some_metal', { colorMap: 'some_metal_c' }, 'metal'), 'metal.webp');
  assert.equal(packTextureFor('black1_plaster', { colorMap: 'black1' }, 'plaster'), null);
  assert.equal(packTextureFor('darkblue1_metaldirty', { colorMap: 'darkblue1' }, 'metal'), null);
  assert.equal(packTextureFor('ayz_floor', { colorMap: 'clip', usage: 'clip' }, 'tile'), null);
  assert.equal(packTextureFor('poster', { colorMap: 'poster_c' }, 'plaster'), null);
});

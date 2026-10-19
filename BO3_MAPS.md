# Black Ops 3 map source in codz

The Custom Maps menu loads Black Ops 3 Radiant source maps (`iwmap 4` `.map` files) as
playable survival maps. Pick a `.map`, or a `.zip` that holds the `.map` plus its `_prefabs`
folder, or paste a `.map` link, or a GitHub repository or `.map` link (the `_prefabs` the map uses are fetched from the repo).
`MattFiler/zm_alien_isolation` is the reference layout.

## What is read

- Brushes from `worldspawn`, including those inside nested `misc_prefab` entities (placed with
  their origin, angles and model scale). Player clip (`clip`, `clip_player`) is drawn as a plain dark shell: in BO3 it is what outlines
  the rooms and props whose models are not in the source map. AI, physics and shadow clip, nodraw,
  trigger, sky and traverse materials are skipped.
- Curves: `mesh` (BO3) and `patchDef` blocks are read as control point grids and drawn as smooth
  quadratic Bezier surfaces (3 wide spans share edge points; 2 wide grids stay flat), two sided.
- Player start: `initial_spawn_points` structs, else `info_player_start`.
- Perks: `zm_perk_machine` structs by `script_noteworthy` (`specialty_*`), Pack-a-Punch
  (`zbarrier_zmcore_packapunch`) and Mystery Boxes (`zbarrier_zmcore_MagicBox` or
  `treasure_chest_use` structs; the box and its struct at the same spot count once).
- Wall buys: `spawnable_weapon_*` prefabs. Stock mod-tools prefabs that are not in the map folder
  (`barricade_*`, `spawnable_weapon_*`) still leave a marker at their place, found by name.
- Zombie spawns: `riser_location`, `spawn_location` structs (dog spawns are left out). Windows: `exterior_goal` structs
  and window or barricade zbarriers, each linked to the nearest spawn.
- `light` entities, by `_color` and `radius`.

## Play area

BO3 maps often keep an intro room far from the real map, so the map is cropped to a box around
the perks, box, Pack-a-Punch and windows. A start that is more than 9000 units from them is moved
onto the nearest site, so the walkable scan stays fine grained. Zombie spawners within 4500 units of a
site widen the box, so the outer rooms are drawn; spawners in another section far away do not.

## Not loaded yet

- Models (`misc_model`, `script_model`) and their textures live in compiled zone files, not in
  the source map, so props are not drawn. `zm_alien_isolation` is mostly models (about 4000 of them
  against about 1000 brushes), so its rooms show as the bare brush shells. Surfaces use a flat colour
  per material.
- Buyable doors and debris are read when a `zombie_door` / `zombie_debris` trigger names a brush
  entity (or has a volume of its own); maps that script their doors in GSC under other names (like
  `zm_alien_isolation`) are not detected. Buyable areas are not wired up, and prefabs from the stock mod tools
  (`_prefabs/zm/...`) are only resolved when they are in the zip.
- Fetching a map from the Steam Workshop is a separate step.

Code: `export/web/custom-maps/iwmap-*.js` and `iwmap.js`; tests: `test/iwmap.test.mjs`.

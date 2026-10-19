# Black Ops 3 map source in codz

The Custom Maps menu loads Black Ops 3 Radiant source maps (`iwmap 4` `.map` files) as
playable survival maps. Pick a `.map`, or a `.zip` that holds the `.map` plus its `_prefabs`
folder, or paste a `.map` link. `MattFiler/zm_alien_isolation` is the reference layout.

## What is read

- Brushes from `worldspawn`, including those inside nested `misc_prefab` entities (placed with
  their origin, angles and model scale). Clip, nodraw, trigger, sky, shadow caster and traverse
  materials are skipped. Patches (curves) are skipped.
- Player start: `initial_spawn_points` structs, else `info_player_start`.
- Perks: `zm_perk_machine` structs by `script_noteworthy` (`specialty_*`), Pack-a-Punch
  (`zbarrier_zmcore_packapunch`) and Mystery Boxes (`zbarrier_zmcore_MagicBox`).
- Zombie spawns: `riser_location` and `spawn_location` structs. Windows: `exterior_goal` structs
  and window or barricade zbarriers, each linked to the nearest spawn.
- `light` entities, by `_color` and `radius`.

## Play area

BO3 maps often keep an intro room far from the real map, so the map is cropped to a box around
the perks, box, Pack-a-Punch and windows. A start that is more than 9000 units from them is moved
onto the nearest site, so the walkable scan stays fine grained.

## Not loaded yet

- Models (`misc_model`, `script_model`) and their textures live in compiled zone files, not in
  the source map, so props are not drawn. Surfaces use a flat colour per material.
- Doors, debris and buyable areas are not wired up, and prefabs from the stock mod tools
  (`_prefabs/zm/...`) are only resolved when they are in the zip.
- Fetching a map from the Steam Workshop is a separate step.

Code: `export/web/custom-maps/iwmap-*.js` and `iwmap.js`; tests: `test/iwmap.test.mjs`.

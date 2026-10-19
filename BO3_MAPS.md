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

## Materials and textures

Radiant maps name their materials but do not hold the images. With a zip that has the map's
`texture_assets/*.gdt` files, each material gets its tint, surface type (metal, glass, plaster, cloth)
and light or transparent settings from them. Any `png`, `jpg`, `webp` or `tga` in the zip whose file
name matches a material's colour map (for example `black1.png` for `black1_plaster`) is used as its
texture, so real textures can be extracted from a game install you own (Greyhound or Wraith export
images) and zipped beside the map. Without an image, a plain surface with a light pattern in the
material's colour is used. Faces are box projected, 128 map units per repeat.

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
- The Steam Workshop itself cannot be downloaded or read here: Black Ops 3 Workshop items are compiled zone files that
  need a Steam account that owns the game, and this engine loads Radiant `.map` source or NZ:P BSP. What works is the
  source an author links in the item's description.

## Workshop menu

The Black Ops 3 Workshop menu searches Steam live through `/api/workshop` (Cloudflare Pages Function, also served by
`npm start`) and falls back to the saved list `maps/workshop/index.json` on static hosts. The saved list is rebuilt by
the "Workshop index" action, which also searches for "cheese tower" and "zombies". When an item's description links a
GitHub repo or `.map` file, the card says `source repo: loads here` and opens it as a map; every other item, and the
"Search Steam for ..." card at the top of a search, opens Steam so you can subscribe in Black Ops 3.

World at War stand-ins (`custom-maps/textures/waw`, from `arrowsv/T5-WaW-Textures`) cover tile and metal materials that have a real colour map but no image in the zip. Flat colours (`black1`, `white1`), clip and tool materials stay plain.

Code: `export/web/custom-maps/iwmap-*.js` and `iwmap.js`; tests: `test/iwmap.test.mjs`.

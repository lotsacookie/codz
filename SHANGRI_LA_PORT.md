# Shangri-La survival port

Shangri-La is a solo survival map built on the shared Zombies combat stack, with no quest.

## Controls

| Input | Action |
| --- | --- |
| WASD / Shift / Space / Ctrl | Move, sprint, jump, crouch |
| Mouse / right mouse | Fire / aim |
| F or E | Interact (hold to repair barricades) |
| R / V / G / 1-3 | Reload, knife, grenade, weapon |

## What is playable

- Eight purchasable doors and debris piles (cost from the map script), which remove their collision and open the navigation mesh.
- Twenty-nine barricaded windows with six boards each; zombies tear boards and enter, and the player can hold F to repair for points.
- Two power switches that must both be thrown; perks other than Quick Revive and Pack-a-Punch need power.
- Quick Revive plus six machines at the original perk positions (Juggernog, Speed Cola, Double Tap, PhD Flopper, Stamin-Up, Deadshot), Pack-a-Punch, Bowie Knife, wall weapons and four Mystery Box locations with the teddy move.
- Rounds, dog rounds, power-ups, points and game over come from the shared rules.

## Data and baking

- `.tools/bake-shangri-la.mjs` bakes static collision; door, debris and window-board parts are excluded and collide at runtime.
- `.tools/bake-shangri-la-nav.mjs` bakes `navigation.bin` and `navigation.json` (spawn candidates) from that collision using the vendored Recast build (`node --import ./.tools/lib/vendor-resolve.mjs ...`).
- `export/web/shangri-la-rules.js` groups doors, barricades, boxes, spawners and power switches from the map entities.

## Known limits

- The six random perk machines all use the Speed Cola model; each is labelled with its perk.
- The baked navigation mesh is fragmented in places. While the map loads, every barricade is checked for a route to the player's spawn (`SurvivalNavigation.prepare`). If the mesh cannot connect them, or fails to load, the level is mapped automatically (`auto-paths.js`): a grid flood fill whose edges are checked against walls, floor continuity and closed doors, so routes cannot pass through geometry. The map is re-checked whenever a door opens. Spawning only uses barricades verified at load, and every movement step on a mapped or breadcrumb route is wall-checked.
- Enemy and render-loop faults are contained (`enemy-guard.js`, per-subsystem guards): a failing spawn or update is logged once and skipped instead of stopping the game. Diagnostics: `window.shangriLa.debug.navigation()` shows the preflight report.
- If `collision.bin` reports a size mismatch the loader discards the cached copy and downloads it once more; a persistent mismatch means `collision.json` and `collision.bin` come from different bakes (re-run the bake or `git lfs pull`).
- The original quest, special enemies and teleport effects are not included.

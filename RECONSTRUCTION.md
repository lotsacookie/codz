Kino reconstruction notes
=========================

The browser game is a JavaScript reimplementation using locally extracted T5 assets. It does not execute the original executable or interpret GSC. This document separates recovered data from behavior that is still approximated.

**Recovered assets and provenance**

The map uses the earlier patched GfxWorld dump in `export/maps/zombie_theater.d3dbsp.gfxworld.*`, the entity dump in `export_fmtprobe/maps/zombie_theater.d3dbsp.ents`, and static model OBJ files in `export/model_export`. The composer includes all 3,326 static model placements, with all 245 distinct static model names resolved after exporting two missing lobby tear-in models from the English fastfile. It also places dynamic brush entities and script models.

Supported assets were exported with OpenAssetTools into `export_game`: raw GSC and related scripts, weapon definitions, materials, images, skeletal GLBs, XAnim files, and string tables. Sources include `common`, `common_zombie`, `zombie_theater`, their applicable patches, and the English theater/common-zombie fastfiles. The English theater zone contains important shared textures and models; omitting it leaves blank banners and doors. The supported animation asset selector is `xanim`, not `xanimparts`.

`export/web/assets/game-data.json` contains 2,794 entities, 32 weapon definitions and their upgrade values, script models, rules, zone links, character models, and 676 decoded animation clips. `asset-report.json` lists remaining unresolved texture references. `provenance.json` records fastfile hashes and the current world inventory. `audio/manifest.json` records archive paths, source hashes, durations, and formats for 445 native cues. These include round music, perk stings, announcements, ambient music, and 115. FFmpeg decodes the IWD entries using its Black Ops Audio support. A resident extractor also reconstructs xWMA from validated fastfile LoadedSound records; see **ANIMATION_NOTES.md**.

Original archives were used as inputs; the reconstruction outputs are separate files.

**Geometry and animation findings**

- T5 world vertices have a 44-byte stride with float32 UVs at byte 20. The earlier T6 world layout uses different UV packing. The composer reads the dump's layout declaration.
- Game coordinates `(x, y, z)` become Three.js `(x, z, -y)`. Placements use the corresponding conjugated transform. The player starts at the original `initial_spawn_points` entity, not the alley viewer position.
- GfxWorld faces are clockwise. Reversing their winding is necessary for correct normals and walkable Recast floors; otherwise stairs and rooms become disconnected. OBJ model winding is retained.
- Compound surface materials identify structural bases and decal layers. The browser currently selects the base albedo. A name containing a blood decal must not cause the structural floor to be removed from collision.
- Material `colorMap` slots are preferred over the first color-semantic texture, which can be a burn mask. Identical base materials are shared to reduce draw calls. Alpha-tested materials use their recovered mask state.
- Invisible collision helper groups stay hidden through static instancing. `theater_extracam_screen` also starts hidden, as specified by the original map script.
- Zombie heads attach at the body's `j_spine4` using the inverse head bind transform. Locomotion `j_mainroot` translations are treated as displacement from the bind pose, with horizontal root motion removed for path-driven movement. Head hit tests use the animated head bone.
- The first-person arms use `viewmodel_usa_pow_arms`, which the map script identifies for Dempsey. Native hand and weapon models attach through `tag_weapon`, `j_gun`, and `tag_view`; hip/ADS, raise, idle/empty idle, firing, reload, sprint and knife clips are decoded from XAnim. Per-weapon torso tracks provide the correct resting positions.
- Native `hideTags` suppress unused attachment bone branches, including the starting pistol's suppressor. Ammo counts are multiplied by magazine size only when `ammoCountClipRelative` is enabled; Ray Gun and Thundergun reserves are absolute counts.

**Implemented gameplay and source references**

| Browser behavior | Primary local source |
| --- | --- |
| Solo round populations and zombie health | `export_game/common_zombie/maps/_zombiemode.gsc`, particularly `round_spawning` and health initialization; `mp/zombiemode.csv` |
| 500 starting points, hit/kill rewards, weapon prices | `mp/zombiemode.csv`, `_zombiemode_score.gsc`, `_zombiemode_weapons.gsc` |
| Weapon magazines, reserves, damage, cadence, reload times, pellets, head multipliers, explosive damage | `export_game/common_zombie/weapons/*_zm` and theater weapon assets |
| Dog round scheduling, populations, and health | `_zombiemode_ai_dogs.gsc` |
| Nova 75% health, 45 melee damage, seven-second cloud and 125-unit cloud radius | `export_game/zombie_theater/maps/_zombiemode_ai_quad.gsc` |
| Power-gated Nova introduction and active zones | `zombie_theater.gsc`, `zombie_theater_quad.gsc`, original spawner entities |
| Door prices, targets, bounds, zone flags, wall buys, perk machines, box locations | Map entities and `zombie_theater.gsc` zone adjacency definitions |
| Stage/lobby linking, projection destination, timed return | `zombie_theater_teleporter.gsc` and its destination entities |
| Bowie Knife purchase | `_zombiemode_bowie.gsc` and the `bowie_upgrade` entity |
| Three music fragments | Original `meteor_egg_trigger` entities and locally decoded `115.wav` |

The current loop includes barricade tearing/entry/repair, navigation with closed-door polygon flags, melee with line-of-sight checks, player/enemy collision, increasing rounds, dogs, mixed Nova spawns, weapon switching, ADS, reload, bursts/automatic fire, knife and grenades, scores, drops, four perks, solo revive, box rolls and relocation, traps, power, two-pad linking, teleport return, upgrades, pause, and restart.

**Remaining differences from native T5**

- Lighting uses browser lights and fog. Native lightmaps, light-grid shading, complete material techniques, normal/specular layering, and post-processing are not reconstructed. Some decals and surfaces therefore look different.
- Collision and Recast navigation are generated from filtered render geometry plus authored dynamic door/window bounds. The original clipMap dump is retained, but its complete native collision and negotiation system is not used. Four main physical routes are tested; this is not proof that every map corner is identical.
- Pursuit, separation, melee timing, speeds, spawn cadence, and stuck recovery are browser logic informed by the original scripts. Nova mixed-spawn pacing, roof/wall entrances, special quad waves, and dog spawn effects are approximations. The Nova cloud uses a simple translucent effect and blur; explosion damage to the player is approximated.
- The 32-weapon roster, upgraded definitions/names, dual models, projectile flight, Claymores, Monkey Bombs and turrets are now connected; see **KINO_COMPLETION.md**. Recoil/spread, penetration, exact upgrade camo and turret behavior still differ from native T5. Both knife types now have their original models and swipe/stab clips, timed damage and impact sounds. Native melee auto-lunge is still absent.
- The 401 recovered resident weapon cues include native knife/Bowie sounds, reload foley and player shots for 29 of 32 base weapons. Commando/SPAS-12/M72 LAW shots, most enemy vocals and some impacts still use procedural fallbacks. Full sound-alias mixing and secondary layers are not reconstructed.
- Mystery Box rolls use the source map's 23-entry pool, with native lid motion, visible weapon cycles, timed offers, independent Fire Sale boxes and teddy relocation. Perk purchases use original bottle animations and sounds; the six Kino powerups use native meshes, HUD icons, announcements and script-derived drop rules. Browser particles, Nuke/Carpenter visual sequencing, box relocation effects, traps, dismemberment, ragdolls, teleporter effects, camera feeds and cinematic events remain simplified. Hidden rooms and the three film reels now work, using the recovered projector atlas. See ZOMBIES_INTERACTIONS.md.
- This is single-player desktop play. Native networking, cooperative revive, controller/mobile controls, and saved runs are not implemented.

These are known reconstruction tasks, not features claimed to match the original. A logical next fidelity pass is native lightmap/material export, complete clipMap collision, resident sound banks, and the remaining scripted events and weapon mechanics.

**Build and verification**

Use `.tools/rebuild-kino.ps1` for the current asset pipeline. Optional `-Extract` refreshes supported fastfile assets; it does not regenerate the initial GfxWorld/clipMap dump. Stock OAT has no T5 world dumper. The retained `.tools/oat_patch/apply.sh` installs the custom GfxWorld and clipMap dumpers into an OAT source checkout; its comments describe the earlier tested revision and build. Existing dumps permit rebuilding without recompiling OAT.

The controller, collision loader, scene-instancing code, and XAnim decoder continue the approach of the Black Ops II port, [Claude of Duty](https://github.com/luckeyfaraday/claude-of-duty). Browser libraries are pinned in `package-lock.json`; the bake copies their modules and license files into `export/web/assets/js/vendor`. Upstream projects: [OpenAssetTools](https://github.com/Laupetin/OpenAssetTools), [Three.js](https://github.com/mrdoob/three.js), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh), and [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js).

Validation includes twenty rule tests, 122 weapon-presentation/audio checks, 14 knife gameplay checks, four physical route tests, 25 general browser checks, 20 drop/box/drink checks, and six additional browser gameplay checks. The weapon check loads, fires, and reloads all 32 weapons; its `--upgraded` mode purchases and retrieves each upgrade first. Browser checks combine real mouse/keyboard input and screenshots with controlled debug setup and accelerated simulation. Reports are `artifacts/qa/report.json`, `artifacts/qa/extras-report.json`, `artifacts/weapons/report.json`, and `artifacts/physical-routes.json`; their scope does not establish pixel-perfect fidelity or long-run balance. Historical failure logs are retained separately as debugging evidence.

The September 2026 gameplay completion pass is documented in **KINO_COMPLETION.md**. That document supersedes earlier feature counts and weapon/equipment omissions in these historical notes.

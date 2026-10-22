# Drops, Mystery Box and perk drinks

This pass uses the locally extracted Black Ops scripts and assets. Original IWDs and fastfiles are unchanged. Runtime flag censorship remains enabled in both the game and map viewer.

## Powerups

Kino's six regular drops now use their original meshes: Max Ammo, Insta-Kill, Double Points, Nuke, Carpenter and Fire Sale. The drop deck comes from `maps/zombie_theater.gsc:271` and `maps/_zombiemode_powerups.gsc:60`. Other maps' Death Machine, Bonfire Sale and free-perk pickups are not added to Kino's regular deck.

The browser implements the shuffled deck, 3% random drop chance, earned-score trigger starting at 2,000 additional points and growing by 14%, and four regular drops per round. Spending does not reduce earned score. Round one excludes Nuke and Fire Sale. Carpenter requires five fully destroyed windows; Fire Sale requires at least one box relocation and cannot randomly drop while active. Regular drops require the map's playable volume. Hellhounds do not roll regular drops; the last dog of a dog round guarantees Max Ammo at its death position.

Pickups appear 40 units above the death position, use animated green glow and wobble, and collect within 64 units of the player's feet, with an additional wall-occlusion check. The source timeout is **26.5 seconds**, not a flat 30: 15 seconds solid, followed by 15 half-second, 10 quarter-second and 15 tenth-second visibility steps. Native HUD icons show the three 30-second timed effects. Repeated timed pickups refresh their timer.

Max Ammo fills both reserves and grenades while leaving magazines unchanged. Carpenter repairs all barricades and grants 200 points. Nuke grants 400 points without individual kill bonuses; nuked zombies retain powerup eligibility as specified in `_zombiemode_spawner.gsc:3306`. Double Points also multiplies these point bonuses. Native spawn/grab, effect sounds, and all six announcer cues play; Fire Sale includes its native music.

The Three.js glow, particles and flash are a browser rendition of the original FX. Native FX definitions are not interpreted. Nuke deaths and Carpenter repairs resolve together rather than reproducing the native staggered visual sequence. The score watcher is evaluated on simulation updates rather than the GSC's half-second polling thread.

## Mystery Box

The original box and hinged lid now open and close by 105 degrees over 0.5 seconds. Original world-weapon models rise during the 3.9-second cycle, with the source's slowing 0.05/0.1/0.2/0.3-second cadence. The chosen model remains claimable for 12 seconds and sinks into the box before it closes. The lid, weapon and offer belong to each location, preventing an offer from being collected at a different box.

All nine map locations activate during Fire Sale at 10 points per spin. Concurrent boxes roll independently. A purchased offer survives the end of Fire Sale until claimed or expired. Inactive bear/rubble props now hide when their box is present. The native opening, music-box, closing and movement sounds are decoded from resident audio records.

Normal spins now use the 23 eligible entries from Kino's include_weapon calls, including Monkey Bombs; wall-only weapons are excluded. Teddy chance follows the source usage thresholds: no teddy before pull four, 15% on pulls four through seven, guaranteed by pull eight at the initial box, then 30% on pulls eight through twelve and 50% thereafter. Teddy refunds the 950-point spin, floats away and moves the box to a different location. Fire Sale spins cannot trigger teddy. Relocation travel and lighting are simplified; this does not reproduce the complete native chest teleport effect or the native weighted selection algorithm.

Sources: `_zombiemode_weapons.gsc:1303`, `:1443`, `:1517`, `:1782`, and `clientscripts/_zombiemode_weapons.csc:53`.

## Perk drinks

Quick Revive, Speed Cola, Double Tap and Juggernog use the four original first-person bottles and `viewmodel_zombie_perksacola_drink/lower`. The bottle's animated `j_gun` root is preserved relative to `tag_weapon`; it must not use the fixed-root attachment employed by ordinary guns. Dempsey's textured arms remain in use.

Purchasing a perk cancels reloading and starts the bottle sequence. Fire, ADS, sprint, knife, grenades, switching and further purchases are blocked until it completes; walking and crouching remain available. Native notifies drive opening, swallowing, bottle breaking and belching sounds. The perk is granted after drinking/lowering, then the held weapon raises again. Downing cancels a pending drink without granting its perk. Pause freezes the sequence; restart clears it.

Sources: the four `weapons/zombie_perk_bottle_*` definitions, their exported XAnims/notifies, and `_zombiemode_perks.gsc:1119` / `:1480`.

## Rebuild and checks

`npm run build:assets` exports the six pickup meshes, three HUD icons, four bottle viewmodels, three bottle clips, 32 weapon worldmodels and teddy. `npm run build:audio` produces 445 cues, including 25 added interaction/announcement/music cues. Their sources and hashes are recorded in `export/web/assets/audio/manifest.json`.

`npm test` covers drop rules, ammo, timers and drinking state. `npm run test:zombies` exercises rendering and live interactions with controlled browser setups; its report and screenshots are in `artifacts/zombies`. `npm run test:gameplay` covers the broader game loop. These checks are accelerated scenarios, not a complete uninterrupted survival playthrough.

See **KINO_COMPLETION.md** for the later arsenal, equipment and projector additions.

Pre-change runtime/build files are in `artifacts/zombies-originals`.

# Moon — solo browser game

Double-click **Play Moon.cmd**, then **Survive Moon**. The launcher starts or reuses this workspace's server and selects an available port from 5173–5183. The current address is saved in `artifacts/moon-url.txt`. **Stop Moon.cmd** stops the server it started. Use Chrome or Edge with hardware acceleration. The native map is large and takes time to load on the first visit.

Start in No Man's Land with 500 points, an M1911 and four grenades. Reach the teleporter, collect a P.E.S. in Receiving Bay, buy passages to the MPD and restore power. Survive rounds, collect equipment and follow the objective journal through the solo Big Bang Theory quest. Survival continues after the ending. **New survival run** resets progression; **Explore map** provides free doors and destination shortcuts.

| Control | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Left / right mouse | Fire / aim; right mouse fires the left gun when dual wielding |
| Shift / Space / Ctrl or C | Sprint / jump / crouch |
| F or E | Interact; hold for repairs, hacking and charging |
| H | Hack a nearby box offer, perk, wall weapon, door, barricade, power-up or Pack-a-Punch |
| R / V / G | Reload / knife / grenade |
| 1, 2, 3 / wheel | Weapon slots; third slot requires Mule Kick |
| B / X | Combine or split the Wave Gun / throw tactical equipment |
| Q | Put on or remove the P.E.S. helmet |
| Tab / M / Esc | Objective journal / sound / pause |

## Implemented

- Original Area 51 and lunar geometry, 5,939 static placements, 188 scripted props, recovered textures and 3,727 map entities. Thirteen purchased door groups use source prices, flags and movement vectors.
- Earth and Moon navigation; closed passages restrict spawning and pursuit. Seventeen barricades support zombie tearing/entry, repair rewards, hacking and Carpenter.
- Endless No Man's Land with escalating siren phases and Hellhounds; lunar rounds, native technician/military-police zombies, teleporting Nova crawlers and the perk-stealing astronaut. The astronaut is excluded from wave completion and resists Wave Gun, Gersh and Nuke effects.
- Teleporters, suit stations, native low gravity, vacuum exposure, powered indoor atmosphere, eleven jump pads and excavators Pi, Omicron and Epsilon. Breached areas remain depressurized after retraction. The Hacker replaces the P.E.S.; suit stations let you switch back.
- Eight perks, four purchased perk slots, three solo Quick Revives, Mule Kick inventory and alternating Juggernog/Speed Cola in Area 51. The soul exchange grants all eight perks permanently.
- Mystery Box using the source Moon item pool, native floating models, teddy refunds/relocation, Fire Sale, equipment offers and Hacker rerolls. Pack-a-Punch consumes 5,000 points and requires retrieving the upgraded weapon before its collection window expires.
- Thirty-three exported weapon definitions including Wave Gun/Zap modes and Death Machine, plus Gersh and QED equipment. Native first-person rigs, P.E.S. arms, firing/reload/melee animations, Bowie Knife, upgrades, projectile explosions, hit detection, ammunition economy and six standard power-ups.
- Solo quest: Simon sequence; Hacker security terminals and timed buttons; Pi breach; linked native Vril Sphere route; first collector and Samantha reveal; Area 51 plates; wire/Vril charging; four collectors; soul exchange; final codes; QED/Gersh sequence; missile launch and destroyed Earth.
- Native star-field/Earth textures, Samantha and quest props, station ambience, music recordings, computer/event cues and weapon audio. The Moon audio manifest contains 1,002 recovered cues.
- No Man's Land water uses its original `zombiecoast__waves_bump` texture, recovered Area 51 colors and scrolling normal layers, with a static yard reflection. `.tools/build_moon_water.py` extracts the texture from the installed IWD and retains source hashes in `moon/water.json`.
- Pause/resume, death/retry, objective journal, equipment/perk/hazard HUD, hack progress and F3 diagnostics. Small collision steps preserve timer speed on slower GPUs.

## Solo quest guide

1. Restore power and repeat the sequences at the four color computers outside Receiving Bay.
2. Collect the Hacker in the laboratories. Hold F at a laboratory button to start security for 500 points, then hack the four green terminals within 70 seconds. Press all four laboratory buttons within 3.5 seconds.
3. Allow Pi to breach Tunnel 6, then hold F at its Receiving Bay control to retract it. Follow the sphere from Tunnel 6: knife it, use the Wave Gun above Receiving Bay, and follow its later stops toward the MPD. Some stops require explosives; the journal shows the next objective.
4. Kill 25 zombies close to the first MPD collector, then use the pyramid switch to reveal Samantha and receive a temporary Death Machine.
5. After the Death Machine expires, grenade the plates on the Area 51 shelf and throw a Gersh beside them. Return to Receiving Bay and use a QED beside the transferred plates. Find the laboratory wire, connect it at the Receiving Bay terminal and hold F there for 60 seconds.
6. Fill each of the four collectors with 25 nearby kills. Insert the charged device to gain permanent perks. Complete the three final computer sequences, use a QED at the MPD sphere, then a Gersh at its computer-side destination. Watch Earth from outside.

Earlier-map/co-op prerequisites are supplied for solo play. Quest items, required hits, nearby souls and puzzles must still be completed. Wave Gun vaporization does not supply souls. Security timeouts and incorrect color inputs can be retried.

## Build and verification

```powershell
npm run build:moon
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File .tools/play-moon.ps1 -NoBrowser
$env:MOON_URL = (Get-Content artifacts/moon-url.txt).Trim()
npm run test:moon
npm run test:moon:combat
npm run test:moon:completion
npm run test:moon:quest
```

Reports and screenshots are in `artifacts/moon`, `artifacts/moon/combat`, `artifacts/moon/completion` and `artifacts/moon/quest`. The quest test drives production input/combat handlers through every stage using supplied inventory, controlled placements, generated enemy deaths and accelerated waits. It is an integration test, not an uninterrupted human playthrough. Completion tests cover purchases, guns, equipment, special enemies, barricades, jump pads, pause and reset. Shared presentation checks run with `npm run test:presentation`.

Verified for this build: 43 unit tests; 17 Moon exploration checks; 26 Moon combat checks; 89 Moon completion checks; 53 quest integration checks; and 122 shared presentation checks. These suites passed with no browser resource/runtime errors. The ending screenshot is `artifacts/moon/quest/big-bang-theory.png`.

Rebuilding needs Python 3.11/Pillow, FFmpeg, Node and retained local OAT dumps. Shared Kino exports must exist first. To refresh raw extraction, run `.tools/rebuild-moon.ps1 -Extract`; this additionally uses `.tools/Unlinker.exe` and the patched WSL exporter `~/oat/build/bin/Release_x64/Unlinker` (override with `-PatchedUnlinker`). Its patch is retained under `.tools/oat_patch`.

Inputs are the installed Moon fastfiles, common-zombie exports and IWD audio archives. Archive hashes are recorded in `export/web/assets/moon/provenance.json`; audio source hashes are in its manifest. Original archives remain unchanged. The browser game and assets are under `export/web`, with map-specific assets under `export/web/assets/moon`. Build tools recover map data, compose geometry, bake collision/navigation, convert rigs and extract audio/presentation textures.

## Fidelity limits

This is a solo browser adaptation, not a full T5 engine replacement. Native clipMap brushes, nonrectangular environment volumes, airlock pressure cycling, original lightmaps/normal/specular shaders, detailed decompression and every map route are not reproduced exactly. Collision derives from render geometry with separate moving barriers. Lighting, sky shaders and combat/equipment effects are approximations.

Quest branches are sequential. Excavator selection guarantees Pi first; scheduling, No Man's Land pacing, QED probabilities/outcomes, jump trajectories and music unlocks differ from the original scripts. Mule Kick uses a manually placed machine. Special AI uses shared animation/state machinery. Dual guns share ammunition/cadence; Ballistic Knife behavior, special upgrade attachments, claymores and sticky grenades are not fully reproduced. There is no multiplayer or save/resume across page reloads.

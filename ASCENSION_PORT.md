# Ascension browser map

Double-click **Play Ascension.cmd** to open directly into `/?map=ascension`. Click the map to capture the mouse. This uses the same local server, asset composer, Three.js renderer, collision loader and movement controller as the Kino/Shangri-La ports.

| Control | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Shift | Sprint; fly faster |
| Space / Ctrl | Jump / crouch; ascend / descend in fly mode |
| F | Toggle walking / flying |
| R | Return to the original centrifuge-room spawn |
| H / F3 | Toggle control hints / diagnostics |
| Esc | Release the mouse and pause movement |

Map-only assets include all **5,902 static placements**, **174 scripted models**, **2,973 source entities**, **429 map textures** and the six native sky faces. Every referenced model was found. Both original asset extraction steps completed with zero warnings and errors. Source archive hashes and the material audit are recorded in `export/web/ascension/provenance.json`.

The lander's 19 linked entities use the arrival position from `zombie_cosmodrome_lander.gsc::new_lander_intro`, with lowered gates from `open_lander_gate`. Rendering and baked collision share those transforms. Floating quest letters and later radio props start hidden according to the original scripts. The viewer displays the colored source assets without the gameplay intro's monochrome filter.

The map opens directly, with no landing page or gameplay menu. Doors, the centrifuge, landers and rocket are static. Fly mode allows inspection of closed areas. Weapons, enemies, purchases, audio, quest logic and machinery sequences are outside this map-only stage.

As with Kino, lighting and compound material layers approximate the original renderer. Native lightmaps, normal/specular shaders, particles and complete clipMap collision are not reproduced. White metal surfaces look brighter without their original baked lighting; flying outside the playable areas reveals source geometry seams and unfinished backs.

```powershell
npm run build:ascension
powershell -NoProfile -ExecutionPolicy Bypass -File .tools/play-ascension.ps1 -NoBrowser
npm run test:ascension
```

Rebuilding uses Python 3.11/Pillow, Node.js and retained local dumps/shared Kino exports. To refresh the raw map extraction, run `.tools/rebuild-ascension.ps1 -Extract`. This invokes the same Windows OpenAssetTools exporter and patched WSL world exporter used by Kino and Shangri-La. Override the latter's path with `-PatchedUnlinker` if necessary. Original archives are unchanged.

Browser files are `export/web/index.html` (the shared map list), `export/web/ascension.js` and `export/web/ascension/`. Reports and screenshots are in `artifacts/ascension/`. The browser suite verifies direct rendering, floor collision, the parked lander, movement, jump/landing, mouse look, fly mode, pausing, reset, resize and asset errors. Additional location screenshots use controlled camera positions, not physical route traversal. All 58 shared unit tests also passed.

The launcher reuses a server only after matching this workspace's health endpoint, or starts one on a free port from 5173–5183. The current URL is saved in `artifacts/ascension-url.txt`. **Stop Ascension.cmd** stops a server recorded as started by this launcher; a reused Kino/Moon server keeps running.

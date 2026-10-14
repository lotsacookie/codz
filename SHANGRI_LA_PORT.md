# Shangri-La browser map

Double-click **Play Shangri-La.cmd**. It opens directly into the map at `/?map=shangri-la`, using the same local server as Kino. Click the map to capture the mouse. There is no landing page or gameplay menu.

| Control | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Shift | Sprint; fly faster |
| Space | Jump; ascend in fly mode |
| Ctrl | Crouch; descend in fly mode |
| F | Toggle walking / flying |
| R | Return to the original spawn |
| H | Hide / show controls |
| Esc | Release the mouse and pause movement |
| F3 | Show rendering diagnostics |

This is the map-only stage: original geometry, textures, foliage, props and sky, with walking collision and free flight. Doors and quest objects remain static; use fly mode to inspect closed areas. No weapons, enemies, survival rules, sound or quest mechanics are included.

The port reuses Kino's `.tools/compose_scene_t5.py`, Three.js modules, `PlayerController`, serialized BVH collision loader and scene instancing. It includes all **5,199 static placements**, **209 scripted models**, **2,389 source entities**, **357 map textures** and all six faces of the native sky cubemap. No referenced model files are missing. The large quest meteor starts hidden, following `zombie_temple_sq.gsc::hide_meteor`; foliage null and shadow cards are hidden before instancing. Dynamic water materials use their source tint with a browser reflection approximation.

Like Kino, this is a browser reconstruction using the installed assets. Lighting, compound material layers, water shaders, foliage motion and particle effects—including falling water—do not reproduce the T5 renderer. Collision is baked from filtered render geometry, and free flight can reveal the original map's unfinished backs and edges. Native lightmaps and complete clipMap collision are retained as future work.

Browser files are in `export/web/index.html` (the shared map list), `export/web/shangri-la.js` and `export/web/shangri-la/`. Original archives are unchanged. `export/web/shangri-la/provenance.json` records source fastfile hashes, counts and materials without albedo textures (water shaders, black/hidden surfaces and weapon tag placeholders).

```powershell
npm run build:shangri-la
powershell -NoProfile -ExecutionPolicy Bypass -File .tools/play-shangri-la.ps1 -NoBrowser
npm run test:shangri-la
```

Building requires Python 3.11/Pillow, Node.js and the retained local Kino/shared exports. To refresh the Shangri-La extraction, run `.tools/rebuild-shangri-la.ps1 -Extract`; this uses the same stock Windows and patched WSL OpenAssetTools exporters as Kino/Moon. Configure the WSL path with `-PatchedUnlinker` if needed. Stock OAT reports an unsupported IWI format 7 for a source effect image; the map's exported material textures and sky load successfully.

Verification: **18 browser checks** cover automatic map rendering, spawn/floor collision, the solid prop behind spawn, walking, jumping, fly mode, pause, reset, resizing and resource errors. **58 shared unit tests** also passed. Screenshots and the browser report are in `artifacts/shangri-la/`; the overview/cave/waterfall views use controlled camera placements and are not physical route tests. Browser verification used desktop Chromium at 1440 × 900.

The launcher reuses a server only after matching this workspace's health endpoint, or starts one on an available port from 5173–5183. The URL is saved in `artifacts/shangri-la-url.txt`. **Stop Shangri-La.cmd** stops only a server recorded as started by this launcher; a reused Kino/Moon server keeps running.

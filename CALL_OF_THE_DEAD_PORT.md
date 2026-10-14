Call of the Dead — browser map
==============================

Double-click **Play Call of the Dead.cmd**. It opens `/?map=call-of-the-dead` on this workspace's local server, directly into the map. There is no landing page or gameplay interface.

Click the map to capture the mouse. **WASD** moves, **Shift** sprints, **Space** jumps, and **Ctrl** crouches. **V** switches between walking and free flight; in flight, Space/Ctrl move up/down. **R** returns to the original beach spawn. **Esc** releases the mouse and pauses movement while keeping the map visible.

The port uses Kino's patched OpenAssetTools T5 world extraction, `compose_scene_t5.py`, Three.js renderer, static instancing, serialized collision BVH, and player controller. A Coast-specific grounding probe handles the capsule's contact with sloped terrain. The export includes all **4,751 static placements**, **95 script models**, **313 composed textures**, the native six-face sky, and the original ocean normal texture. No source models are missing.

Purchase doors are placed in their source-defined open poses and purchase debris is hidden so the map can be explored. Buildings, props, perk machines and weapon wall models remain as scenery. Free flight reaches areas that normally require scripted transport.

As with Kino, this reconstructs browser lighting and collision from the original assets; it is not pixel-identical T5 rendering. Native lightmaps, complete layered materials, volumetric weather, the original water shader, scripted transport and gameplay are outside this map-only build. Water uses the recovered normal texture and source color/scroll settings with a browser material. The source game archives are unchanged.

Run `npm run build:coast` to rebuild from the retained dumps. To extract fresh map data first, run `powershell -NoProfile -ExecutionPolicy Bypass -File .tools/rebuild-coast.ps1 -Extract`. Rebuilding requires the existing Python 3.11/Pillow and Node installation; extraction also uses `.tools/Unlinker.exe` and the patched WSL Unlinker used for Kino. Shared source assets from the existing Kino export supply referenced common models and textures.

Run `npm run test:coast` for browser verification. It starts or reuses the local server and checks direct loading, the native beach spawn, keyboard movement, jumping, crouching, cursor release/resume, flight/reset, floor collision at six additional map locations, resizing and asset errors. Reports and screenshots are in `artifacts/call-of-the-dead`. Landmark checks use controlled camera placement; they do not establish that every possible walking route matches T5.

Runtime files are `export/web/index.html` (the shared map list), `call-of-the-dead.js`, `coast-controller.js` and `export/web/coast`. `coast/provenance.json` records source hashes; `coast/composition.json` records asset coverage. Add `?debug` to expose `window.coast` for inspection.

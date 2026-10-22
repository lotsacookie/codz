# Agent development guide

This project is a browser-based Three.js reconstruction of Black Ops (T5)
Zombies maps. Runtime code is in `export/web` (entry pages) and `export/web/assets` (`js/`, data, textures, audio, models); build, test, and diagnostic
tools are in `.tools`. Agents must verify gameplay and rendering changes in a
real browser; source inspection alone is not sufficient for changes that can
affect runtime behavior or visuals.

## Standard workflow

1. Make the smallest relevant change.
2. Run `npm test` for the rule, data, and touch-input checks.
3. Start the local server with `npm start` (port 5173). Most browser checks
   expect it; `test:mobile`, `test:mobile:memory`, `test:pages`, and the Moon
   combat, completion, and quest checks start their own.
4. Run the browser checks for the affected map and inspect their reports,
   console errors, failed requests, and screenshots under `artifacts/`:
   - Kino: `test:gameplay`, `test:extras`, `test:weapons`, `test:completion`,
     `test:presentation`, `test:melee`, `test:zombies`, `test:routes`
   - Moon: `test:moon`, `test:moon:combat`, `test:moon:completion`,
     `test:moon:quest`
   - Shangri-La, Call of the Dead, Ascension: `test:shangri-la`,
     `test:coast`, `test:ascension`
   - Touch input or mobile layout: `test:mobile`
5. `window.kino.debug` and `window.moon.debug` expose entity, navigation,
   collision, combat, and audio state for structured inspection.

The browser checks use `playwright-core` with the installed Chrome or Edge.
Generated artifacts are local evidence and must not be committed.

## Repository rules

- `.gitignore` whitelists the browser project. Never commit game archives
  (`main`, `zone`), extraction dumps (`export_*`), or extraction executables.
- Mesh and collision binaries (`*.bin`, `*.glb`) and large textures and audio
  use Git LFS. Add new large media to `.gitattributes` before committing it.
- Rebuild scripts (`.tools/rebuild-*.ps1`) need a local game installation and
  the patched OpenAssetTools build described in `RECONSTRUCTION.md`.

# Loading, hosting and quality switches

## What changed
* **Real progress.** The loading bar reports bytes (`Loading the theater · 48 / 143 MB`) instead of sitting at 15%.
* **Resilient downloads.** Every large file streams through `asset-loader.js`: stalled requests (no data for 20 s)
  are aborted and retried with backoff, 404/403 fail fast, and failures show a message plus a **RETRY** button.
* **Git LFS pointers are detected.** If a host serves the 130-byte LFS pointer instead of the real file, the game says
  which file and how large it should be, and tries alternate hosts (below) before giving up.
* **Parallel and cached.** Geometry, collision, navmesh and the recast WASM download/initialise together (phones keep
  one-at-a-time *parsing* so peak memory is unchanged). Large files are kept in Cache Storage, so later visits skip the
  download; a changed file size on the server invalidates the cached copy.
* **Loads from anywhere.** All URLs resolve against the page, so any folder or sub-path works.
* **Textures use the same loader, and the game knows when they are ready.** Map, character and weapon textures go
  through `asset-loader.js` too (retries, a 60 s stall window, LFS-pointer fallback). Identical textures are fetched once,
  at most 6 at a time (3 on phones). Every download is checked for completeness (PNG/JPEG/WebP end markers), so a file cut
  short by a chunking proxy is fetched again instead of decoding as blank. Each texture is tracked as pending, ready or
  failed; the loading screen shows `textures 212 / 417`, and the game only reports **Ready** once none are pending and
  none have failed.
* **Failures heal.** A texture that cannot be loaded gets a flat placeholder so the model still builds, then the loader
  retries it (3 rounds with backoff) and swaps the real image in place. If some still fail you get **RETRY** or
  **PLAY ANYWAY**. For scripts and browser tests, `window.kino.debug` reports `texturesTotal`, `texturesLoaded`,
  `texturesPending`, `failedTextures`, `failedTextureList` and a single `texturesReady` boolean.
* **Order.** The 91 MB collision download now starts after the map and its textures are in, so on a slow or proxied
  connection it cannot starve the ~400 texture requests. The byte counter covers geometry/collision/navmesh only;
  textures are counted separately (this is why the total used to grow while downloading).
* **Less hitching at the start.** On desktop the shaders are compiled and the textures uploaded to the GPU behind the
  loading screen (a time-capped "Preparing graphics" step) instead of during the first seconds of play.

## Hosting
Serve `export/web` with the real files, not LFS pointers (`git lfs pull` before deploying). If you cannot, point the
game at a host that has them:
* `?assets=https://host/path/` (comma-separate several), or
* `window.KINO_ASSET_BASES=['https://host/path/']` before the module loads.
On `<user>.github.io/<repo>/` the loader also tries `media.githubusercontent.com/media/<user>/<repo>/main/export/web/`
(best effort; requires that host to allow cross-origin reads).

## Asset pack: one download for textures, models and animations
Kino requests ~590 textures, 137 models and 676 animation files. `npm run build:pack` bundles them into one file per
device profile, so the game makes one request instead of ~1400:

* `export/web/asset-pack/kino-desktop.pack` (~166 MB) and `kino-mobile.pack` (~85 MB, uses the `textures-mobile` images).
* The loader fetches the pack with the normal resilient downloader (byte progress, retries, stall detection, Cache
  Storage, LFS-pointer detection), then serves every texture, model and animation from memory. Anything not in the pack,
  or any pack that is missing, truncated or an LFS pointer, falls back to the individual files, so a bad pack cannot
  break the game.
* The builder refuses to pack Git LFS pointers or missing files. Run `git lfs pull` first.
* The packs are committed to `export/web/asset-pack/` through Git LFS (`*.pack` in `.gitattributes`), so they are
  served from the same place as `index.html` and the other LFS files (the game requests
  `asset-pack/kino-<profile>.pack`). Deploy with the LFS files pulled, as for `kino.bin`.
* The builder is deterministic: unchanged inputs give byte-identical packs, so a rebuild with nothing new commits
  nothing. `npm run verify:pack` compares the packs with the files on disk and fails if they are stale.
* No computer needed: the **Build asset pack** workflow rebuilds, verifies and commits both packs to `main`. It runs
  automatically when a push to `main` changes textures, models, animations, `kino.gltf`, `game-data.json` or the pack
  tooling, and manually from GitHub → Actions → Build asset pack → Run workflow.
* Every changed pack adds its full size (~250 MB for both) to the repository's Git LFS storage, and the old versions stay
  there. Check the LFS quota before rebuilding often.
* `?pack=0` skips the pack and loads files individually, for before/after comparisons.

## Optional: smaller downloads
`node .tools/compress-assets.mjs` writes `*.bin.gz` plus `asset-manifest.json`. Add
`<meta name="kino-asset-manifest" content="asset-manifest.json">` to `index.html` to use them. Check the printed ratios first.

## Quality switches (all URL parameters)
| Parameter | Effect |
| --- | --- |
| `?perf=1` | overlay with fps, render scale, draw calls, triangles - use it to compare before/after |
| `?adaptive=0` | disable dynamic resolution |
| `?fx=0` | disable the vignette/grain overlay |
| `?prewarm=0` | skip the shader/texture pre-warm during loading |

Dynamic resolution lowers the render scale (down to 65% desktop / 60% mobile) when frames run long and probes back up
when stable. Anisotropic filtering (8x desktop, 2x mobile) is applied to world textures before their first upload.
Zombies now turn with eased, rate-limited yaw instead of snapping to the next path node.

## Not verified here
The real Kino geometry could not be downloaded in the authoring environment, so frame rates and visual quality were
not measured. Loader behaviour was verified with unit tests and in headless Chromium against pointer and placeholder files.

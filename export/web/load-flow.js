import { assets } from './asset-loader.js';
import { detectMobile, texturesSettled, textureReport, retryFailedTextures, loadedTextures } from './runtime-assets.js';

/**
 * Kino's loading sequence, shared by every map: asset manifest, asset packs, texture retry with the
 * RETRY / PLAY ANYWAY prompt, and the shader / texture prewarm. Maps call these instead of keeping their own copies.
 */

const packsDisabled = () => /[?&]pack=0\b/.test(location.search);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function loadManifest() {
  const meta = document.querySelector('meta[name="kino-asset-manifest"]');
  if (meta) await assets.loadManifest(meta.content || 'asset-manifest.json');
}

/** Download asset packs (one request each). Entries may be a path or a function of `mobile`. A bad pack never stops a map. */
export function loadPacks(list, mobile = detectMobile()) {
  if (packsDisabled()) return Promise.resolve([]);
  return Promise.all(list.map(pack => assets.loadPack(typeof pack === 'function' ? pack(mobile) : pack)));
}

/** Kino's pack for the current device; the models and textures of every shared prop (machines, box, Pack-a-Punch). */
export const kinoPack = mobile => `asset-pack/kino-${mobile ? 'mobile' : 'desktop'}.pack`;

/**
 * Wait for every requested texture, retrying failures with backoff. If some still fail the player is asked whether to
 * retry (which sends them back to the map list) or play anyway.
 */
export async function ensureTextures(ctx, { at = .89 } = {}) {
  for (let round = 0; round < 3; round++) {
    await texturesSettled();
    let report = textureReport();
    if (!report.failed) return report;
    ctx.progress(`Retrying ${report.failed} texture${report.failed > 1 ? 's' : ''}`, at);
    await sleep(700 * 2 ** round);
    report = await retryFailedTextures();
    if (!report.failed) return report;
  }
  const report = textureReport();
  console.warn('Textures still missing:', report.failedList);
  const choice = await ctx.choice(`${report.failed} texture${report.failed > 1 ? 's' : ''} failed to load`, ['RETRY', 'PLAY ANYWAY']);
  if (choice === 0) throw new Error('Some textures failed to load. Go back to the maps and open the map again to retry.');
  return report;
}

/**
 * Compile shaders and upload textures behind the loading screen so the first frames don't hitch.
 * `scenes` is a list of [scene, camera]; `withTarget` optionally wraps compilation in a render target (Kino's grade pass).
 */
export async function prewarm({ ctx, renderer, scenes, mobile = detectMobile(), withTarget = null, from = .9, to = .99 }) {
  if (mobile || /[?&]prewarm=0\b/.test(location.search)) return;
  const sources = new Set(), textures = [], started = performance.now();
  for (const value of loadedTextures()) if (!sources.has(value.source)) { sources.add(value.source); textures.push(value); }
  try {
    withTarget?.begin();
    await Promise.race([Promise.all(scenes.map(([scene, camera]) => renderer.compileAsync(scene, camera))), sleep(6000)]);
  } catch (error) {
    console.warn('Shader pre-compile skipped', error);
  } finally {
    withTarget?.end();
  }
  for (let i = 0; i < textures.length && performance.now() - started < 12000; i++) {
    renderer.initTexture(textures[i]);
    if (i % 8 === 7) { ctx.progress(`Preparing graphics · ${Math.round(i / textures.length * 100)}%`, from + i / textures.length * (to - from)); await sleep(0); }
  }
}

import * as THREE from 'three';

// Reference fx sheets (fxt_fire_gas_flash, fxt_smk_puff) pack equally sized frames side by side.
// Frames are cloned textures that share the loaded image and differ only in repeat/offset, so a
// sprite can swap frames per shot without recompiling its material.

export function atlasFrame(index, frames) {
  const count = Math.max(1, Math.floor(frames));
  const i = ((Math.floor(index) % count) + count) % count;
  return { repeatX: 1 / count, offsetX: i / count };
}

export function pickFrame(frames, random = Math.random) {
  const count = Math.max(1, Math.floor(frames));
  return Math.min(count - 1, Math.floor(random() * count));
}

const atlases = new Map();

// Starts loading once per url. `frames` stays empty until the image arrives (or forever if there
// is no DOM / the file is missing), so callers keep their procedural fallback in that case.
export function loadAtlas(url, frames) {
  let atlas = atlases.get(url);
  if (atlas) return atlas;
  atlas = { url, frames: [], failed: false };
  atlases.set(url, atlas);
  if (typeof document === 'undefined') {
    atlas.failed = true;
    return atlas;
  }
  new THREE.TextureLoader().load(url, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < frames; i++) {
      const frame = texture.clone();
      const { repeatX, offsetX } = atlasFrame(i, frames);
      frame.repeat.set(repeatX, 1);
      frame.offset.set(offsetX, 0);
      frame.needsUpdate = true;
      atlas.frames.push(frame);
    }
  }, undefined, () => { atlas.failed = true; });
  return atlas;
}

export function randomFrame(atlas, random = Math.random) {
  return atlas.frames.length ? atlas.frames[pickFrame(atlas.frames.length, random)] : null;
}

export function disposeAtlases() {
  for (const atlas of atlases.values()) for (const frame of atlas.frames) frame.dispose();
  atlases.clear();
}

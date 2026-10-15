import { assets } from './asset-loader.js';
import { detectMobile } from './runtime-assets.js';

const loads = new Map();

export const sharedPackPath = (name, mobile) => `asset-pack/${name}${mobile ? '-mobile' : ''}.pack`;

export function preloadShared(names = ['weapons', 'enemies']) {
  if (/[?&]pack=0\b/.test(location.search)) return Promise.resolve([]);
  const mobile = detectMobile();
  return Promise.all(names.map(name => {
    const path = sharedPackPath(name, mobile);
    if (!loads.has(path)) loads.set(path, assets.loadPack(path));
    return loads.get(path);
  }));
}

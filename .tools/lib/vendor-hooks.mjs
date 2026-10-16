import path from 'node:path';
import { pathToFileURL } from 'node:url';

const vendor = path.resolve(import.meta.dirname, '../../export/web/vendor');
const exact = {
  'three': 'three.module.js',
  'three-mesh-bvh': 'bvh.js',
  '@recast-navigation/core': 'recast-core.mjs',
  '@recast-navigation/wasm': 'recast-wasm.js'
};

export async function resolve(specifier, context, next) {
  if (exact[specifier]) return { url: pathToFileURL(path.join(vendor, exact[specifier])).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: pathToFileURL(path.join(vendor, 'jsm', specifier.slice('three/addons/'.length))).href, shortCircuit: true };
  return next(specifier, context);
}

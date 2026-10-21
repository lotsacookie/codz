import * as THREE from 'three';

const CAMO_URL = 'textures/camo_packapunch_spec.png';
const CAMO_REPEAT = 3;
const SKIP = /lens|glass|reticle|sight_glow|flash/i;

let camoTexture = null;

export function packCamoTexture() {
  if (camoTexture || typeof document === 'undefined') return camoTexture;
  camoTexture = new THREE.TextureLoader().load(CAMO_URL);
  camoTexture.wrapS = camoTexture.wrapT = THREE.RepeatWrapping;
  camoTexture.colorSpace = THREE.SRGBColorSpace;
  camoTexture.anisotropy = 4;
  return camoTexture;
}

export function isCamoTarget(material) {
  if (!material || !material.isMeshStandardMaterial || !material.map) return false;
  if (material.transparent && material.opacity < 1) return false;
  return !SKIP.test(material.name || '');
}

const FRAGMENT_PARS = `uniform sampler2D tPapCamo;
uniform float uPapRepeat;
float papTrace = 0.0;`;

const FRAGMENT_MAP = `#include <map_fragment>
vec3 papSample = texture2D( tPapCamo, vMapUv * uPapRepeat ).rgb;
papTrace = clamp( ( papSample.r - max( papSample.g, papSample.b ) ) * 3.2, 0.0, 1.0 );
float papGrey = clamp( ( papSample.g + papSample.b ) * 0.5, 0.0, 1.0 );
float papLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
vec3 papBoard = vec3( 0.035, 0.06, 0.07 ) + vec3( 0.05, 0.09, 0.08 ) * papGrey + vec3( papLum ) * 0.35;
vec3 papCopper = vec3( 0.95, 0.16, 0.08 );
diffuseColor.rgb = mix( diffuseColor.rgb, mix( papBoard, papCopper, papTrace ), 0.88 );`;

const FRAGMENT_EMISSIVE = `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3( 0.75, 0.08, 0.04 ) * papTrace * 0.55;`;

export function patchPackCamo(material, texture) {
  const uniforms = { tPapCamo: { value: texture }, uPapRepeat: { value: CAMO_REPEAT } };
  material.userData.packCamo = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.tPapCamo = uniforms.tPapCamo;
    shader.uniforms.uPapRepeat = uniforms.uPapRepeat;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAGMENT_PARS}\nvoid main() {`)
      .replace('#include <map_fragment>', FRAGMENT_MAP)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'pack-camo';
  material.needsUpdate = true;
  return material;
}

export function applyPackCamo(root) {
  const texture = packCamoTexture();
  if (!texture) return 0;
  let count = 0;
  root.traverse(object => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    const next = list.map(material => {
      if (material?.userData?.packCamo || !isCamoTarget(material)) return material;
      count++;
      return patchPackCamo(material.clone(), texture);
    });
    object.material = Array.isArray(object.material) ? next : next[0];
  });
  return count;
}

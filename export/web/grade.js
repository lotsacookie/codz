import * as THREE from 'three';
import { gradeUniforms, THEATER_BLOOM } from './vision.js';

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform vec3 cam;
uniform float aoStrength;
uniform float aoRadius;
uniform float bloomIntensity;
uniform float bloomThreshold;
uniform float bloomRadius;
uniform float exposure;
uniform vec3 whiteBalance;
uniform vec3 saturation;
uniform vec3 darkTint;
uniform vec3 midTint;
uniform vec3 lightTint;
uniform vec3 contrast;
uniform vec4 region;
varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 acesFilmic(vec3 color) {
  const mat3 inputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 outputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );
  color *= exposure / 0.6;
  color = inputMat * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = outputMat * (a / b);
  return clamp(color, 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

float viewZ(vec2 uv) {
  float d = textureLod(tDepth, uv, 0.0).x;
  return 2.0 * cam.x * cam.y / (cam.y + cam.x - (d * 2.0 - 1.0) * (cam.y - cam.x));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float ambientOcclusion() {
  float z0 = viewZ(vUv);
  if (z0 >= cam.y * 0.9) return 1.0;
  float radiusPx = clamp(aoRadius * cam.z / z0, 2.0, 48.0);
  float angle = hash(gl_FragCoord.xy) * 6.2831853;
  float occlusion = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = (float(i) + 0.5) / 12.0;
    float a = angle + float(i) * 2.399963;
    vec2 offset = vec2(cos(a), sin(a)) * radiusPx * sqrt(t) * texel;
    float dz = z0 - viewZ(vUv + offset);
    occlusion += smoothstep(aoRadius * 0.04, aoRadius * 0.25, dz) * (1.0 - smoothstep(aoRadius * 0.8, aoRadius * 2.0, dz));
  }
  return 1.0 - aoStrength * occlusion / 12.0;
}

vec3 bloom() {
  vec3 sum = vec3(0.0);
  for (int l = 3; l <= 6; l++) {
    float lod = float(l);
    vec2 px = texel * exp2(lod) * bloomRadius;
    for (int k = 0; k < 5; k++) {
      vec2 o = k == 0 ? vec2(0.0) : (k == 1 ? vec2(1.0, 0.0) : (k == 2 ? vec2(-1.0, 0.0) : (k == 3 ? vec2(0.0, 1.0) : vec2(0.0, -1.0))));
      vec3 s = textureLod(tScene, vUv + o * px, lod).rgb;
      s *= smoothstep(bloomThreshold, bloomThreshold + 0.8, dot(s, LUMA));
      sum += s;
    }
  }
  return sum / 20.0;
}

void main() {
  vec3 c = max(textureLod(tScene, vUv, 0.0).rgb, 0.0);
  c *= ambientOcclusion();
  c += bloom() * bloomIntensity;
  c *= whiteBalance;
  float l = dot(c, LUMA);
  float v = l / (1.0 + l);
  float dark = 1.0 - smoothstep(region.x * (1.0 - region.z), region.x * (1.0 + region.z), v);
  float light = smoothstep(region.y * (1.0 - region.w), region.y * (1.0 + region.w), v);
  float mid = max(0.0, 1.0 - dark - light);
  float total = max(dark + mid + light, 1e-4);
  c *= (dark * darkTint + mid * midTint + light * lightTint) / total;
  c = mix(vec3(dot(c, LUMA)), c, saturation);
  c = pow(max(c, 0.0) / 0.18, contrast) * 0.18;
  c = acesFilmic(c);
  gl_FragColor = vec4(linearToSrgb(c), 1.0);
}`;

export class GradePass {
  constructor(renderer, { samples = 4, vision } = {}) {
    this.renderer = renderer;
    this.size = new THREE.Vector2();
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter
    });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.target.depthTexture.minFilter = THREE.NearestFilter;
    this.target.depthTexture.magFilter = THREE.NearestFilter;
    const g = gradeUniforms(vision);
    const v3 = values => new THREE.Vector3(...values);
    this.uniforms = {
      tScene: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      texel: { value: new THREE.Vector2(1, 1) },
      cam: { value: new THREE.Vector3(1, 14000, 1) },
      aoStrength: { value: 0.55 },
      aoRadius: { value: 70 },
      bloomIntensity: { value: THEATER_BLOOM.colorScale * 0.6 },
      bloomThreshold: { value: 0.9 },
      bloomRadius: { value: THEATER_BLOOM.blurRadius },
      exposure: { value: renderer.toneMappingExposure },
      whiteBalance: { value: v3(g.whiteBalance) },
      saturation: { value: v3(g.saturation) },
      darkTint: { value: v3(g.darkTint) },
      midTint: { value: v3(g.midTint) },
      lightTint: { value: v3(g.lightTint) },
      contrast: { value: v3(g.contrast) },
      region: { value: new THREE.Vector4(...g.region) }
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }

  sync() {
    this.renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, this.size.x);
    const height = Math.max(1, this.size.y);
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    this.uniforms.texel.value.set(1 / width, 1 / height);
  }

  render(scene, camera, overlayScene, overlayCamera, showOverlay) {
    const renderer = this.renderer;
    this.sync();
    this.uniforms.cam.value.set(camera.near, camera.far, camera.projectionMatrix.elements[5] * this.size.y * 0.5);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    if (showOverlay) {
      renderer.clearDepth();
      renderer.render(overlayScene, overlayCamera);
    }
    renderer.setRenderTarget(null);
    this.uniforms.exposure.value = renderer.toneMappingExposure;
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
}

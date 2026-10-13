import * as THREE from 'three';
import { gradeUniforms } from './vision.js';

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = `
uniform sampler2D tScene;
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

void main() {
  vec3 c = max(texture2D(tScene, vUv).rgb, 0.0);
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
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    const g = gradeUniforms(vision);
    const v3 = values => new THREE.Vector3(...values);
    this.uniforms = {
      tScene: { value: this.target.texture },
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

  sync() {
    this.renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, this.size.x);
    const height = Math.max(1, this.size.y);
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
  }

  render(scene, camera, overlayScene, overlayCamera, showOverlay) {
    const renderer = this.renderer;
    this.sync();
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

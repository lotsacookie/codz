import * as THREE from 'three';

// The native water has no diffuse image. Its color and moving normal layers
// come from wc/a51_water; treating it as a generic glTF material made it white.
export async function loadMoonWater(root) {
  const response = await fetch('moon/water.json');
  if (!response.ok) throw new Error('Moon water data is missing. Run .tools/build_moon_water.py.');
  const data = await response.json(), c = data.constants;
  const normal = await new THREE.TextureLoader().loadAsync('moon/' + data.normalMap);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.colorSpace = THREE.NoColorSpace;
  const offsets = new THREE.Vector4();
  const scale = c.waterNormalPositionScale;
  const meshes = [];
  const material = new THREE.MeshPhongMaterial({
    name: data.material,
    color: new THREE.Color(...c.waterColorN.slice(0, 3)),
    specular: new THREE.Color(...c.waterColorS.slice(0, 3)),
    shininess: c.waterControlVar1[1],
    normalMap: normal, normalScale: new THREE.Vector2(.6, .6),
    side: THREE.DoubleSide, combine: THREE.MixOperation,
  });
  material.userData.sourceMaterialNames = [data.material];
  material.onBeforeCompile = shader => {
    shader.uniforms.moonWaterOffsets = {value: offsets};
    shader.uniforms.moonWaterDetailScale = {value: new THREE.Vector2(scale[2]/scale[0], scale[3]/scale[1])};
    shader.uniforms.moonWaterFresnel = {value: new THREE.Vector2(...c.waterControlVar0.slice(2))};
    shader.fragmentShader = shader.fragmentShader.replace('#include <normalmap_pars_fragment>', `
      #include <normalmap_pars_fragment>
      uniform vec4 moonWaterOffsets;
      uniform vec2 moonWaterDetailScale;
      uniform vec2 moonWaterFresnel;
    `).replace('#include <normal_fragment_maps>', `
      vec3 lowWave = texture2D(normalMap, vNormalMapUv + moonWaterOffsets.xy).xyz * 2.0 - 1.0;
      vec3 highWave = texture2D(normalMap, vNormalMapUv * moonWaterDetailScale + moonWaterOffsets.zw).xyz * 2.0 - 1.0;
      vec3 waterNormal = normalize(vec3((lowWave.xy + highWave.xy) * normalScale, lowWave.z * highWave.z));
      normal = normalize(tbn * waterNormal);
    `).replace('#include <envmap_fragment>', THREE.ShaderChunk.envmap_fragment.replaceAll(
      'specularStrength * reflectivity',
      '(moonWaterFresnel.x + moonWaterFresnel.y * pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 5.0))'
    ));
  };
  material.customProgramCacheKey = () => 'moon-native-water-v1';
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!object.isMesh || Array.isArray(object.material) || !(object.material.userData.sourceMaterialNames ?? [object.material.name]).includes(data.material)) return;
    object.material = material;
    meshes.push(object);
    // The T5 shader projects world XY (browser X,-Z), ignoring editor UVs.
    // Clone only the water geometry so collision and other surfaces stay intact.
    object.geometry = object.geometry.clone();
    const positions = object.geometry.attributes.position, point = new THREE.Vector3();
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      uv[i*2] = point.x * scale[0]; uv[i*2+1] = -point.z * scale[1];
    }
    object.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  });
  const lo = c.waterLoNormalScroll, hi = c.waterHiNormalScroll, speed = c.waterNormalScrollSpeed;
  return {material, offsets, captureReflection(renderer, scene) {
    // One small static probe supplies the yard reflection. Ripples distort it
    // each frame; there is no recurring six-camera render during gameplay.
    if (!meshes.length) return;
    const bounds = new THREE.Box3().setFromObject(meshes[0]);
    const reflection = new THREE.WebGLCubeRenderTarget(128, {type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter});
    const probe = new THREE.CubeCamera(1, 6000, reflection);
    probe.position.set((bounds.min.x + bounds.max.x)/2, bounds.max.y + 8, THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, .78));
    const autoClear = renderer.autoClear;
    const visibility = meshes.map(mesh => mesh.visible);
    try {
      renderer.autoClear = true;
      meshes.forEach(mesh => {mesh.visible = false;});
      probe.update(renderer, scene);
    } finally {
      renderer.autoClear = autoClear;
      meshes.forEach((mesh, i) => {mesh.visible = visibility[i];});
    }
    material.envMap = reflection.texture;
    material.needsUpdate = true;
  }, update(dt) {
    offsets.x = (offsets.x + lo[0] * speed[2] * dt) % 1;
    offsets.y = (offsets.y + lo[1] * speed[2] * dt) % 1;
    offsets.z = (offsets.z + hi[2] * speed[1] * dt) % 1;
    offsets.w = (offsets.w + hi[3] * speed[1] * dt) % 1;
  }};
}

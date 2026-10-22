// Render the theater's printed banners as plain cloth. Retain the source
// texture's alpha for torn edges, but never use its printed RGB in the output.
export function censorFlags(root){
  const replacements=new Map();
  const replace=material=>{
    if(material.name.replace(/^,/, '')!=='wc/decal_flag_nazi_theater')return material;
    if(replacements.has(material))return replacements.get(material);
    const cloth=material.clone();
    cloth.name='plain_red_theater_banner';cloth.roughness=1;
    cloth.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float clothShade = 1.0;
        #ifdef USE_MAP
          clothShade = 0.87 + 0.07 * sin(vMapUv.x * 37.0 + sin(vMapUv.y * 9.0))
            + 0.035 * sin(vMapUv.x * 91.0 + vMapUv.y * 5.0);
        #endif
        diffuseColor.rgb = vec3(0.18, 0.027, 0.022) * clothShade;
      `);
    };
    cloth.customProgramCacheKey=()=> 'plain-theater-banner-v1';
    replacements.set(material,cloth);return cloth;
  };
  root.traverse(object=>{
    if(!object.isMesh)return;
    object.material=Array.isArray(object.material)?object.material.map(replace):replace(object.material);
  });
  return replacements.size;
}

// Pure BSP reader (no three.js): Quake BSP29 and GoldSrc BSP30, the formats NZ:P maps ship in.
// BSP30 stores a palette inside every texture and RGB lightmaps; BSP29 uses the Quake palette
// below and single-channel lightmaps.

const QUAKE_PALETTE_B64 = 'AAAADw8PHx8fLy8vPz8/S0tLW1tba2tre3t7i4uLm5ubq6uru7u7y8vL29vb6+vrDwsHFw8LHxcLJxsPLyMTNysXPy8XSzcbUzsbW0MfY0sfa1Mfc1cfe18jg2cjj28jCwsPExMbGxsnJyczLy8/NzdLPz9XR0dnT09zW1t/Y2OLa2uXc3Oje3uvg4O7i4vLAAAABwcACwsAExMAGxsAIyMAKysHLy8HNzcHPz8HR0cHS0sLU1MLW1sLY2MLa2sPBwAADwAAFwAAHwAAJwAALwAANwAAPwAARwAATwAAVwAAXwAAZwAAbwAAdwAAfwAAExMAGxsAIyMALysANy8AQzcASzsHV0MHX0cHa0sLd1MPg1cTi1sTl18bo2Mfr2cjIxMHLxcLOx8PSyMTVysXYy8fczcjfzsrj0Mzn08zr2Mvv3cvz48r36sn78sf//MbCwcAGxMAKyMPNysTRzMbUzcjYz8rb0czf1M/i19Hm2tTp3tft4drw5N706OL47OXq4ujn3+Xk3OHi2d7f1tvd1Nja0tXXz9LVzdDSy83QycvNx8jKxcbIxMTFwsLDwcHu3Ofr2uPo1+Dl1d3i09rf0tfc0NTaztLXzM/Uys3RyMrOx8jLxcbIxMTFwsLDwcH28O7y7Onv6Obr5eLo4d7l3tvh29fe2NTa1dHX0s7Uz8zQzMnNysfJx8XGxMPDwsHb4N7Z3tvX3NnV2tfT2NXR1tPP1NHN0s/L0M3KzsvIzMnHysfFyMXDxsTCxMLBwsH//Mb798X28sTy7cPu6cPq5cLm4MHi3MHe2MHa1MAW0cASzcAOysAKx8AGw8ACwcAAAD/CwvvExPfGxvPIyO/KyuvLy+fLy+PLy9/Ly9vLy9fKytPIyM/GxsvExMfCwsPKwAAOwAASwcAXwcAbw8AfxcHkx8HoycLtzMPw0sbz2Mr238745dP56tf779399OLp3s7t5s3x8M35+NXf7//q+f/1///ZwAAiwAAswAA1wAA/wAA//OT//fH////n1tT';
let quakePalette = null;
export function defaultPalette() {
  if (!quakePalette) {
    const text = atob(QUAKE_PALETTE_B64);
    quakePalette = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) quakePalette[i] = text.charCodeAt(i);
  }
  return quakePalette;
}

const LUMP = { entities: 0, planes: 1, textures: 2, vertices: 3, texinfo: 6, faces: 7, lighting: 8, edges: 12, surfedges: 13, models: 14 };

// Textures that only exist for the map compiler or the engine and must never be drawn or walked on.
export const HIDDEN_TEXTURES = /^(sky\d*|trigger|aaatrigger|clip|null|origin|skip|hint|bevel|nodraw|solidhint|noclip)$/i;
export const isWaterTexture = name => /^[!*]/.test(name);

export function parseEntities(text) {
  const entities = [];
  const pattern = /\{([^}]*)\}/g;
  let block;
  while ((block = pattern.exec(text))) {
    const entity = {};
    for (const [, key, value] of block[1].matchAll(/"([^"]*)"\s+"([^"]*)"/g)) entity[key] = value;
    if (entity.classname) entities.push(entity);
  }
  return entities;
}

export const parseVector = (text, fallback = [0, 0, 0]) => {
  const parts = String(text ?? '').trim().split(/\s+/).map(Number);
  return parts.length >= 3 && parts.every(Number.isFinite) ? parts.slice(0, 3) : fallback;
};

// Transparent texels of "{" textures use palette index 255, which is pure blue. Mipmapping and filtering
// blend that blue into the visible edge (a gate looks blue from an angle), so fill the transparent texels
// with the colour of their nearest opaque neighbours. Alpha is left alone.
function bleedMasked(rgba, width, height) {
  const total = width * height;
  let done = new Uint8Array(total), sumR = 0, sumG = 0, sumB = 0, opaque = 0;
  for (let p = 0; p < total; p++) if (rgba[p * 4 + 3]) { done[p] = 1; sumR += rgba[p * 4]; sumG += rgba[p * 4 + 1]; sumB += rgba[p * 4 + 2]; opaque++; }
  if (!opaque) { for (let p = 0; p < total; p++) rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = 0; return; }
  for (let pass = 0; pass < 32; pass++) {
    const next = done.slice();
    let filled = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (done[p]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = ((y + dy + height) % height) * width + ((x + dx + width) % width);
        if (done[q]) { r += rgba[q * 4]; g += rgba[q * 4 + 1]; b += rgba[q * 4 + 2]; n++; }
      }
      if (n) { rgba[p * 4] = r / n; rgba[p * 4 + 1] = g / n; rgba[p * 4 + 2] = b / n; next[p] = 1; filled++; }
    }
    done = next;
    if (!filled) break;
  }
  const mr = sumR / opaque, mg = sumG / opaque, mb = sumB / opaque;
  for (let p = 0; p < total; p++) if (!done[p]) { rgba[p * 4] = mr; rgba[p * 4 + 1] = mg; rgba[p * 4 + 2] = mb; }
}

export function parseBsp(buffer) {
  const data = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const version = view.getInt32(0, true);
  if (version !== 29 && version !== 30) throw new Error(`Unsupported BSP version ${version}. Only Quake (29) and GoldSrc (30) BSP files can be loaded.`);
  const rgbLight = version === 30;
  const lump = index => ({ offset: view.getInt32(4 + index * 8, true), length: view.getInt32(8 + index * 8, true) });
  const check = (name, index, size) => {
    const { offset, length } = lump(index);
    if (offset < 0 || length < 0 || offset + length > data.byteLength || length % size) throw new Error(`The BSP file is damaged (bad ${name} lump).`);
    return { offset, count: length / size, length };
  };

  const entityLump = lump(LUMP.entities);
  const entities = parseEntities(new TextDecoder('latin1').decode(bytes.subarray(entityLump.offset, entityLump.offset + entityLump.length)).replace(/\0.*$/s, ''));

  const vertexLump = check('vertex', LUMP.vertices, 12);
  const vertices = new Float32Array(vertexLump.count * 3);
  for (let i = 0; i < vertices.length; i++) vertices[i] = view.getFloat32(vertexLump.offset + i * 4, true);

  const edgeLump = check('edge', LUMP.edges, 4);
  const surfedgeLump = check('surfedge', LUMP.surfedges, 4);
  const texinfoLump = check('texinfo', LUMP.texinfo, 40);
  const faceLump = check('face', LUMP.faces, 20);
  const planeLump = check('plane', LUMP.planes, 20);
  const modelLump = check('model', LUMP.models, 64);
  const lightingLump = lump(LUMP.lighting);

  const textures = [];
  const textureLump = lump(LUMP.textures);
  if (textureLump.length >= 4) {
    const base = textureLump.offset;
    const count = view.getInt32(base, true);
    for (let i = 0; i < count; i++) {
      const rel = view.getInt32(base + 4 + i * 4, true);
      if (rel < 0) { textures.push({ name: `missing${i}`, width: 16, height: 16, rgba: null }); continue; }
      const at = base + rel;
      let end = at;
      while (end < at + 16 && bytes[end]) end++;
      const name = new TextDecoder('latin1').decode(bytes.subarray(at, end));
      const width = view.getUint32(at + 16, true), height = view.getUint32(at + 20, true);
      const mip0 = view.getUint32(at + 24, true);
      if (!mip0 || !width || !height || width > 4096 || height > 4096 || at + mip0 + width * height > data.byteLength) {
        textures.push({ name, width: width || 16, height: height || 16, rgba: null });
        continue;
      }
      let palette = defaultPalette();
      if (rgbLight) {
        const tail = at + mip0 + Math.floor(width * height * 85 / 64);
        if (tail + 2 + 768 <= data.byteLength && view.getUint16(tail, true) === 256) palette = bytes.subarray(tail + 2, tail + 2 + 768);
      }
      const masked = name.startsWith('{');
      const rgba = new Uint8Array(width * height * 4);
      for (let p = 0; p < width * height; p++) {
        const color = bytes[at + mip0 + p];
        rgba[p * 4] = palette[color * 3];
        rgba[p * 4 + 1] = palette[color * 3 + 1];
        rgba[p * 4 + 2] = palette[color * 3 + 2];
        rgba[p * 4 + 3] = masked && color === 255 ? 0 : 255;
      }
      if (masked) bleedMasked(rgba, width, height);
      textures.push({ name, width, height, rgba });
    }
  }

  const texinfo = [];
  for (let i = 0; i < texinfoLump.count; i++) {
    const o = texinfoLump.offset + i * 40;
    const f = k => view.getFloat32(o + k * 4, true);
    texinfo.push({ s: [f(0), f(1), f(2), f(3)], t: [f(4), f(5), f(6), f(7)], texture: view.getInt32(o + 32, true), flags: view.getInt32(o + 36, true) });
  }

  const faces = [];
  for (let i = 0; i < faceLump.count; i++) {
    const o = faceLump.offset + i * 20;
    faces.push({ plane: view.getUint16(o, true), side: view.getInt16(o + 2, true), firstEdge: view.getInt32(o + 4, true), edges: view.getInt16(o + 8, true), texinfo: view.getInt16(o + 10, true), lightOffset: view.getInt32(o + 16, true), style: bytes[o + 12] });
  }

  // Plane normals (x, y, z per plane) so the mesh builder can check face winding against the map's own data.
  const planes = new Float32Array(planeLump.count * 3);
  for (let i = 0; i < planeLump.count; i++) for (let k = 0; k < 3; k++) planes[i * 3 + k] = view.getFloat32(planeLump.offset + i * 20 + k * 4, true);

  const models = [];
  for (let i = 0; i < modelLump.count; i++) {
    const o = modelLump.offset + i * 64;
    models.push({ firstFace: view.getInt32(o + 56, true), faceCount: view.getInt32(o + 60, true), mins: [0, 4, 8].map(k => view.getFloat32(o + k, true)), maxs: [12, 16, 20].map(k => view.getFloat32(o + k, true)) });
  }

  const faceVertices = face => {
    const out = [];
    for (let k = 0; k < face.edges; k++) {
      const surf = view.getInt32(surfedgeLump.offset + (face.firstEdge + k) * 4, true);
      const edge = Math.abs(surf);
      if (edge >= edgeLump.count) return null;
      const vertex = view.getUint16(edgeLump.offset + edge * 4 + (surf < 0 ? 2 : 0), true);
      if (vertex >= vertexLump.count) return null;
      out.push(vertex);
    }
    return out;
  };

  // Average colour (0..1) of a face's first lightmap, or null when the face is unlit.
  const faceLight = (face, points) => {
    if (face.lightOffset < 0 || !lightingLump.length || face.style === 255) return null;
    const info = texinfo[face.texinfo];
    let minS = Infinity, maxS = -Infinity, minT = Infinity, maxT = -Infinity;
    for (const [x, y, z] of points) {
      const s = x * info.s[0] + y * info.s[1] + z * info.s[2] + info.s[3];
      const t = x * info.t[0] + y * info.t[1] + z * info.t[2] + info.t[3];
      minS = Math.min(minS, s); maxS = Math.max(maxS, s); minT = Math.min(minT, t); maxT = Math.max(maxT, t);
    }
    const w = Math.ceil(maxS / 16) - Math.floor(minS / 16) + 1, h = Math.ceil(maxT / 16) - Math.floor(minT / 16) + 1;
    const stride = rgbLight ? 3 : 1, size = w * h;
    const start = lightingLump.offset + face.lightOffset;
    if (w <= 0 || h <= 0 || start + size * stride > lightingLump.offset + lightingLump.length) return null;
    let r = 0, g = 0, b = 0;
    for (let p = 0; p < size; p++) {
      if (rgbLight) { r += bytes[start + p * 3]; g += bytes[start + p * 3 + 1]; b += bytes[start + p * 3 + 2]; }
      else { const v = bytes[start + p]; r += v; g += v; b += v; }
    }
    return [r / size / 255, g / size / 255, b / size / 255];
  };

  return { version, entities, vertices, textures, texinfo, faces, models, planes, faceVertices, faceLight };
}

// Brush models the level draws as static scenery (everything else is a door, trigger, lift, ...).
const STATIC_BRUSHES = new Set(['func_wall', 'func_illusionary', 'func_detail']);

export function staticModelIndexes(entities, modelCount) {
  const indexes = new Set([0]);
  for (const entity of entities) {
    if (!STATIC_BRUSHES.has(entity.classname)) continue;
    const match = /^\*(\d+)$/.exec(entity.model ?? '');
    const index = match ? Number(match[1]) : -1;
    if (index > 0 && index < modelCount && Number(entity.rendermode ?? 0) === 0) indexes.add(index);
  }
  return [...indexes];
}

export function summarizeEntities(entities) {
  const count = name => entities.filter(entity => entity.classname === name).length;
  return {
    perks: entities.filter(entity => /^perk_/.test(entity.classname) && entity.classname !== 'perk_pap').length,
    packAPunch: count('perk_pap'),
    mysteryBox: count('mystery_box'),
    zombieSpawns: count('spawn_zombie'),
    windows: count('item_barricade'),
    wallWeapons: count('weapon_wall') + count('buy_weapon'),
    doors: count('func_door_nzp'),
    powerSwitch: count('power_switch') > 0,
  };
}

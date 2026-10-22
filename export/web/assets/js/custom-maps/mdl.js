import { defaultPalette } from './bsp-parse.js';

export function parseMdl(buffer) {
  const data = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  if (bytes.length < 84 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'IDPO') throw new Error('Not a Quake MDL file.');
  const version = view.getInt32(4, true);
  if (version !== 6) throw new Error(`Unsupported MDL version ${version}.`);
  const scale = [0, 1, 2].map(k => view.getFloat32(8 + k * 4, true));
  const translate = [0, 1, 2].map(k => view.getFloat32(20 + k * 4, true));
  const skinCount = view.getInt32(48, true);
  const skinWidth = view.getInt32(52, true);
  const skinHeight = view.getInt32(56, true);
  const vertexCount = view.getInt32(60, true);
  const triangleCount = view.getInt32(64, true);
  const frameCount = view.getInt32(68, true);
  if (skinWidth <= 0 || skinHeight <= 0 || skinWidth > 4096 || skinHeight > 4096 || vertexCount <= 0 || triangleCount <= 0 || frameCount <= 0 || skinCount < 0) throw new Error('The MDL header is damaged.');
  const need = (at, size) => {
    if (at < 0 || at + size > bytes.length) throw new Error('The MDL file is truncated.');
  };

  let at = 84;
  const skins = [];
  const skinSize = skinWidth * skinHeight;
  for (let i = 0; i < skinCount; i++) {
    need(at, 4);
    const group = view.getInt32(at, true);
    at += 4;
    let count = 1;
    if (group) {
      need(at, 4);
      count = view.getInt32(at, true);
      at += 4 + count * 4;
    }
    need(at, count * skinSize);
    skins.push(bytes.slice(at, at + skinSize));
    at += count * skinSize;
  }

  need(at, vertexCount * 12);
  const texcoords = [];
  for (let i = 0; i < vertexCount; i++) {
    const o = at + i * 12;
    texcoords.push({ seam: view.getInt32(o, true) !== 0, s: view.getInt32(o + 4, true), t: view.getInt32(o + 8, true) });
  }
  at += vertexCount * 12;

  need(at, triangleCount * 16);
  const triangles = new Int32Array(triangleCount * 4);
  for (let i = 0; i < triangleCount; i++) {
    const o = at + i * 16;
    triangles[i * 4] = view.getInt32(o, true);
    for (let k = 0; k < 3; k++) triangles[i * 4 + 1 + k] = view.getInt32(o + 4 + k * 4, true);
  }
  at += triangleCount * 16;

  const frames = [];
  const decode = from => {
    need(from, 8 + 16 + vertexCount * 4);
    const positions = new Float32Array(vertexCount * 3);
    const base = from + 24;
    for (let i = 0; i < vertexCount; i++) {
      for (let k = 0; k < 3; k++) positions[i * 3 + k] = bytes[base + i * 4 + k] * scale[k] + translate[k];
    }
    return positions;
  };
  for (let i = 0; i < frameCount; i++) {
    need(at, 4);
    const type = view.getInt32(at, true);
    at += 4;
    if (type === 0) {
      frames.push(decode(at));
      at += 24 + vertexCount * 4;
    } else {
      need(at, 4);
      const count = view.getInt32(at, true);
      at += 4 + 8 + count * 4;
      frames.push(decode(at));
      at += count * (24 + vertexCount * 4);
    }
  }
  for (let i = 0; i < triangleCount; i++) {
    for (let k = 1; k < 4; k++) if (triangles[i * 4 + k] < 0 || triangles[i * 4 + k] >= vertexCount) throw new Error('The MDL file has a bad triangle index.');
  }
  return { skinWidth, skinHeight, skins, texcoords, triangles, frames, vertexCount };
}

export function skinToRgba(indexed, palette = defaultPalette()) {
  const rgba = new Uint8Array(indexed.length * 4);
  for (let i = 0; i < indexed.length; i++) {
    const color = indexed[i];
    rgba[i * 4] = palette[color * 3];
    rgba[i * 4 + 1] = palette[color * 3 + 1];
    rgba[i * 4 + 2] = palette[color * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export function decodePcx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 129 || bytes[0] !== 10 || bytes[2] !== 1 || bytes[3] !== 8) throw new Error('Unsupported PCX file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const planes = bytes[65];
  const perLine = view.getUint16(66, true);
  if (planes !== 1 || width <= 0 || height <= 0 || width > 4096 || height > 4096) throw new Error('Unsupported PCX file.');
  const paletteAt = bytes.length - 769;
  if (paletteAt < 128 || bytes[paletteAt] !== 12) throw new Error('The PCX file has no palette.');
  const palette = bytes.subarray(paletteAt + 1, paletteAt + 769);
  const indexed = new Uint8Array(perLine * height);
  let read = 128, write = 0;
  while (write < indexed.length && read < paletteAt) {
    let value = bytes[read++];
    let run = 1;
    if ((value & 0xc0) === 0xc0) {
      run = value & 0x3f;
      value = bytes[read++];
    }
    while (run-- > 0 && write < indexed.length) indexed[write++] = value;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = indexed[y * perLine + x];
      const o = (y * width + x) * 4;
      rgba[o] = palette[color * 3];
      rgba[o + 1] = palette[color * 3 + 1];
      rgba[o + 2] = palette[color * 3 + 2];
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba, alpha: false };
}

export function decodeTga(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 18) throw new Error('Unsupported TGA file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const type = bytes[2];
  const mapLength = view.getUint16(5, true);
  const mapDepth = bytes[7];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const depth = bytes[16];
  const topDown = (bytes[17] & 0x20) !== 0;
  if ((type !== 2 && type !== 10) || (depth !== 24 && depth !== 32) || !width || !height || width > 4096 || height > 4096) throw new Error('Unsupported TGA file.');
  const step = depth / 8;
  let read = 18 + idLength + (colorMapType ? mapLength * Math.ceil(mapDepth / 8) : 0);
  const pixels = new Uint8Array(width * height * step);
  if (type === 2) pixels.set(bytes.subarray(read, read + pixels.length));
  else {
    let write = 0;
    while (write < pixels.length && read < bytes.length) {
      const header = bytes[read++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        for (let i = 0; i < count && write < pixels.length; i++) {
          for (let k = 0; k < step; k++) pixels[write + k] = bytes[read + k];
          write += step;
        }
        read += step;
      } else {
        const size = Math.min(count * step, pixels.length - write);
        pixels.set(bytes.subarray(read, read + size), write);
        write += size;
        read += count * step;
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  let alpha = false;
  for (let y = 0; y < height; y++) {
    const source = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = (source * width + x) * step;
      const o = (y * width + x) * 4;
      rgba[o] = pixels[i + 2];
      rgba[o + 1] = pixels[i + 1];
      rgba[o + 2] = pixels[i];
      const a = step === 4 ? pixels[i + 3] : 255;
      rgba[o + 3] = a;
      if (a < 255) alpha = true;
    }
  }
  return { width, height, rgba, alpha };
}

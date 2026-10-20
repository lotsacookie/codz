import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { dirname } from 'node:path';
import zlib from 'node:zlib';

export const FX_PATTERN = /(^|[\/_\\])(fx|fxt|fxanim|vfx|efx)([_\/\\.]|$)|muzzle|shellej|blood|gib|explo|flash|impact|spark|smoke|fire|debris|steam|ember|lightning|elec|trail|splash|spatter|glow|flare|particle|dust|beam|bolt/i;

export function safeRelative(name) {
  const parts = String(name).split(/[\\/]+/).filter(part => part && part !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.map(part => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_')).join('/');
}

async function readFully(handle, buffer, position) {
  let done = 0;
  while (done < buffer.length) {
    const { bytesRead } = await handle.read(buffer, done, buffer.length - done, position + done);
    if (!bytesRead) throw new Error('unexpected end of file');
    done += bytesRead;
  }
  return buffer;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function listParts(directory) {
  let names;
  try {
    names = await readdir(directory);
  } catch {
    return null;
  }
  if (!names.length || names.some(name => !/^\d+$/.test(name))) return null;
  const sorted = names.map(Number).sort((a, b) => a - b);
  if (sorted.some((value, index) => value !== index)) return null;
  return sorted.map(value => `${directory}/${value}`);
}

export async function concatParts(parts, outFile) {
  await mkdir(dirname(outFile), { recursive: true });
  const hash = createHash('sha256');
  const out = createWriteStream(outFile);
  try {
    for (const part of parts) {
      for await (const chunk of createReadStream(part)) {
        hash.update(chunk);
        if (!out.write(chunk)) await once(out, 'drain');
      }
    }
    out.end();
    await once(out, 'finish');
  } catch (error) {
    out.destroy();
    throw error;
  }
  return hash.digest('hex');
}

export async function openZip(file) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tailSize = Math.min(size, 65557);
    const tail = await readFully(handle, Buffer.alloc(tailSize), size - tailSize);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error(`not a zip archive: ${file}`);
    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    const directory = await readFully(handle, Buffer.alloc(directorySize), directoryOffset);
    const entries = [];
    let at = 0;
    for (let index = 0; index < count; index++) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central directory: ${file}`);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      entries.push({
        name: directory.toString('utf8', at + 46, at + 46 + nameLength),
        method: directory.readUInt16LE(at + 10),
        compressed: directory.readUInt32LE(at + 20),
        length: directory.readUInt32LE(at + 24),
        offset: directory.readUInt32LE(at + 42)
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    const read = async entry => {
      const header = await readFully(handle, Buffer.alloc(30), entry.offset);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header: ${entry.name}`);
      const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const raw = await readFully(handle, Buffer.alloc(entry.compressed), start);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`unsupported zip method ${entry.method}: ${entry.name}`);
    };
    return { entries, read, close: () => handle.close() };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function openKspk(file) {
  const handle = await open(file, 'r');
  try {
    const head = await readFully(handle, Buffer.alloc(24), 0);
    if (head.toString('latin1', 0, 4) !== 'KSPK') throw new Error(`not a KSPK sound pack: ${file}`);
    const count = head.readUInt32LE(8);
    const index = await readFully(handle, Buffer.alloc(head.readUInt32LE(12)), 24);
    const records = [];
    let at = 0;
    for (let item = 0; item < count; item++) {
      const nameLength = index.readUInt32LE(at + 12);
      records.push({
        offset: index.readUInt32LE(at),
        length: index.readUInt32LE(at + 4),
        format: index.readUInt32LE(at + 8),
        sha256: index.subarray(at + 16, at + 48).toString('hex'),
        name: index.toString('utf8', at + 48, at + 48 + nameLength)
      });
      at += 48 + nameLength;
    }
    const read = record => readFully(handle, Buffer.alloc(record.length), record.offset);
    return { records, read, close: () => handle.close() };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function parseKsixNames(buffer) {
  const text = buffer.toString('latin1');
  const names = new Map();
  const clipPattern = /clips\/[0-9a-f]{64}\.wav/g;
  let match;
  while ((match = clipPattern.exec(text))) {
    let start = match.index;
    while (start > 0 && text.charCodeAt(start - 1) >= 0x20 && text.charCodeAt(start - 1) < 0x7f) start--;
    const run = text.slice(start, match.index);
    const root = run.search(/(?:english|sound)\\/);
    const name = root >= 0 ? run.slice(root) : /\.wav$/i.test(run) ? run : null;
    if (name) names.set(match[0], name);
  }
  return names;
}

export function inflateZone(buffer) {
  const magic = buffer.toString('latin1', 0, 8);
  // IWffr100 (reference-pack zones) stores the zone body uncompressed right after the 12-byte header.
  if (magic === 'IWffr100') return { data: buffer.subarray(12) };
  if (magic !== 'IWffu100') return { error: `unsupported fastfile variant ${JSON.stringify(magic)}` };
  try {
    return { data: zlib.inflateSync(buffer.subarray(12), { finishFlush: zlib.constants.Z_SYNC_FLUSH }) };
  } catch (error) {
    return { error: `inflate failed: ${error.message}` };
  }
}

export function scanNames(data, minLength = 5, maxLength = 160) {
  const found = new Set();
  const chunk = 1 << 25;
  const pattern = new RegExp(`[A-Za-z0-9_./\\\\-]{${minLength},${maxLength}}`, 'g');
  for (let at = 0; at < data.length; at += chunk) {
    const last = at + chunk >= data.length;
    const text = data.toString('latin1', at, Math.min(data.length, at + chunk + maxLength));
    for (const match of text.matchAll(pattern)) if (last || match.index < chunk) found.add(match[0]);
  }
  return found;
}

export function parseWeaponFile(buffer) {
  const text = buffer.toString('latin1');
  if (!text.startsWith('WEAPONFILE\\')) return null;
  const fields = text.split('\\');
  const values = {};
  for (let index = 1; index + 1 < fields.length; index += 2) values[fields[index]] = fields[index + 1];
  return values;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (let index = 0; index < buffer.length; index++) c = crcTable[(c ^ buffer[index]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

export function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function expand565(value) {
  return [
    Math.round(((value >> 11) & 31) * 255 / 31),
    Math.round(((value >> 5) & 63) * 255 / 63),
    Math.round((value & 31) * 255 / 31)
  ];
}

export function decodeDxt(data, width, height, variant) {
  const rgba = Buffer.alloc(width * height * 4);
  const blockBytes = variant === 1 ? 8 : 16;
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      const at = (by * blocksWide + bx) * blockBytes;
      const colorAt = variant === 1 ? at : at + 8;
      const c0 = data.readUInt16LE(colorAt);
      const c1 = data.readUInt16LE(colorAt + 2);
      const p0 = expand565(c0);
      const p1 = expand565(c1);
      const palette = [[...p0, 255], [...p1, 255]];
      if (variant === 1 && c0 <= c1) {
        palette.push([(p0[0] + p1[0]) >> 1, (p0[1] + p1[1]) >> 1, (p0[2] + p1[2]) >> 1, 255], [0, 0, 0, 0]);
      } else {
        palette.push(
          [Math.floor((2 * p0[0] + p1[0]) / 3), Math.floor((2 * p0[1] + p1[1]) / 3), Math.floor((2 * p0[2] + p1[2]) / 3), 255],
          [Math.floor((p0[0] + 2 * p1[0]) / 3), Math.floor((p0[1] + 2 * p1[1]) / 3), Math.floor((p0[2] + 2 * p1[2]) / 3), 255]
        );
      }
      const bits = data.readUInt32LE(colorAt + 4);
      let alphaTable = null;
      let alphaBits = null;
      if (variant === 5) {
        const a0 = data[at];
        const a1 = data[at + 1];
        alphaTable = [a0, a1];
        if (a0 > a1) for (let i = 1; i <= 6; i++) alphaTable.push(Math.floor(((7 - i) * a0 + i * a1) / 7));
        else {
          for (let i = 1; i <= 4; i++) alphaTable.push(Math.floor(((5 - i) * a0 + i * a1) / 5));
          alphaTable.push(0, 255);
        }
        alphaBits = [data.readUIntLE(at + 2, 3), data.readUIntLE(at + 5, 3)];
      }
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const i = py * 4 + px;
          const color = palette[(bits >> (2 * i)) & 3];
          let alpha = color[3];
          if (variant === 3) alpha = ((data[at + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
          if (variant === 5) alpha = alphaTable[i < 8 ? (alphaBits[0] >> (3 * i)) & 7 : (alphaBits[1] >> (3 * (i - 8))) & 7];
          const out = (y * width + x) * 4;
          rgba[out] = color[0];
          rgba[out + 1] = color[1];
          rgba[out + 2] = color[2];
          rgba[out + 3] = alpha;
        }
      }
    }
  }
  return rgba;
}

const IWI_HEADER = 48;
const IWI_BLOCK_FORMATS = { 11: 1, 12: 3, 13: 5 };
const IWI_RAW_BYTES = { 1: 4, 2: 3, 3: 2, 4: 1 };

function mipBytes(format, width, height) {
  if (IWI_BLOCK_FORMATS[format]) {
    return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * (format === 11 ? 8 : 16);
  }
  return width * height * IWI_RAW_BYTES[format];
}

export function decodeIwi(buffer) {
  if (buffer.length < IWI_HEADER || buffer.toString('latin1', 0, 3) !== 'IWi' || buffer[3] !== 13) return { error: 'not a Black Ops IWI' };
  const format = buffer[4];
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const depth = buffer.readUInt16LE(10);
  const info = { format, width, height };
  if (!IWI_BLOCK_FORMATS[format] && !IWI_RAW_BYTES[format]) return { ...info, error: `unsupported IWI format ${format}` };
  if (!width || !height || depth !== 1) return { ...info, error: 'unsupported IWI layout' };
  const top = mipBytes(format, width, height);
  const body = buffer.length - IWI_HEADER;
  if (body < top) return { ...info, error: 'truncated IWI' };
  const data = buffer.subarray(buffer.length - top);
  if (IWI_BLOCK_FORMATS[format]) return { ...info, rgba: decodeDxt(data, width, height, IWI_BLOCK_FORMATS[format]) };
  const rgba = Buffer.alloc(width * height * 4);
  let hasAlpha = false;
  if (format === 3) for (let pixel = 0; pixel < width * height && !hasAlpha; pixel++) hasAlpha = data[pixel * 2 + 1] !== 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const out = pixel * 4;
    if (format === 1) {
      rgba[out] = data[pixel * 4 + 2];
      rgba[out + 1] = data[pixel * 4 + 1];
      rgba[out + 2] = data[pixel * 4];
      rgba[out + 3] = data[pixel * 4 + 3];
    } else if (format === 2) {
      rgba[out] = data[pixel * 3 + 2];
      rgba[out + 1] = data[pixel * 3 + 1];
      rgba[out + 2] = data[pixel * 3];
      rgba[out + 3] = 255;
    } else if (format === 3) {
      rgba[out] = rgba[out + 1] = rgba[out + 2] = data[pixel * 2];
      rgba[out + 3] = hasAlpha ? data[pixel * 2 + 1] : 255;
    } else {
      rgba[out] = rgba[out + 1] = rgba[out + 2] = 255;
      rgba[out + 3] = data[pixel];
    }
  }
  return { ...info, rgba };
}

// Finds script/raw-file payloads in a decompressed T5 zone without walking asset structs (the walker loses sync on some zones).
// A RawFile body is [u32 length][u32 compressedLength][zlib stream]; its name is the C string just before that header.
export function scanRawFiles(data, maxLength = 1 << 26) {
  const files = [];
  let at = 16;
  while ((at = data.indexOf(0x78, at)) >= 0) {
    const start = at++;
    const level = data[start + 1];
    if (level !== 0x01 && level !== 0x5e && level !== 0x9c && level !== 0xda) continue;
    const length = data.readUInt32LE(start - 8), packed = data.readUInt32LE(start - 4);
    if (!length || !packed || length > maxLength || packed > maxLength || start + packed > data.length) continue;
    let text;
    try { text = zlib.inflateSync(data.subarray(start, start + packed), { maxOutputLength: length + 1 }); } catch { continue; }
    if (text.length !== length) continue;
    let end = start - 8;
    while (end > 0 && data[end - 1] === 0) end--;
    let first = end;
    while (first > 0 && data[first - 1] >= 0x21 && data[first - 1] < 0x7f) first--;
    const name = data.toString('latin1', first, end).replace(/\\/g, '/').replace(/^[^\w]+/, '');
    files.push({ name: /^[\w./-]+\.\w+$/.test(name) ? name : null, data: text });
    at = start + packed;
  }
  return files;
}

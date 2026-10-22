const MAGIC = [0x4b, 0x50, 0x41, 0x4b];
const VERSION = 1;
const HEADER_BYTES = 16;

export function encodePack(entries) {
  const files = {};
  const seen = new Set();
  let offset = 0;
  for (const { path, bytes } of entries) {
    if (typeof path !== 'string' || !path) throw new Error('asset pack entry needs a path');
    if (seen.has(path)) throw new Error(`duplicate asset pack entry: ${path}`);
    seen.add(path);
    files[path] = [offset, bytes.byteLength];
    offset += bytes.byteLength;
  }
  const index = new TextEncoder().encode(JSON.stringify({ files }));
  const out = new Uint8Array(HEADER_BYTES + index.byteLength + offset);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, index.byteLength, true);
  view.setUint32(12, offset, true);
  out.set(index, HEADER_BYTES);
  const base = HEADER_BYTES + index.byteLength;
  for (const { path, bytes } of entries) out.set(bytes, base + files[path][0]);
  return out;
}

export function parsePack(bytes) {
  if (!bytes || bytes.byteLength < HEADER_BYTES) throw new Error('asset pack is too small to be valid');
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw new Error('not an asset pack (bad signature)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== VERSION) throw new Error(`unsupported asset pack version ${version}`);
  const indexLength = view.getUint32(8, true);
  const dataLength = view.getUint32(12, true);
  if (HEADER_BYTES + indexLength + dataLength !== bytes.byteLength) {
    throw new Error(`asset pack is truncated or damaged (expected ${HEADER_BYTES + indexLength + dataLength} bytes, got ${bytes.byteLength})`);
  }
  const files = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + indexLength))).files;
  const base = HEADER_BYTES + indexLength;
  const table = new Map();
  for (const [path, range] of Object.entries(files ?? {})) {
    const [start, length] = range;
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > dataLength) {
      throw new Error(`asset pack entry is out of range: ${path}`);
    }
    table.set(path, [base + start, length]);
  }
  return {
    count: table.size,
    byteLength: bytes.byteLength,
    has: path => typeof path === 'string' && table.has(path),
    get(path) {
      const range = typeof path === 'string' ? table.get(path) : undefined;
      return range ? bytes.subarray(range[0], range[0] + range[1]) : undefined;
    },
    paths: () => [...table.keys()],
  };
}

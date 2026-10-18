const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('The download is not a valid zip archive.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== CENTRAL) throw new Error('The zip archive is damaged.');
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (size === 0xffffffff || local === 0xffffffff) throw new Error('Zip64 archives are not supported.');
    if (view.getUint32(local, true) !== LOCAL) throw new Error('The zip archive is damaged.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflate(data));
    else throw new Error(`Unsupported zip compression (${method}).`);
  }
  return files;
}

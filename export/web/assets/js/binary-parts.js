// Stream directly into the final allocation. Holding all fetched parts before
// joining them doubled the collision buffer at the busiest point of startup.
export async function loadBinaryParts(parts, { baseUrl, byteLength, onProgress, fetchPart } = {}) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || !parts?.length) throw new Error('Invalid collision binary layout');
  const output = new Uint8Array(byteLength);
  let offset = 0;
  onProgress?.({ loaded: 0, total: byteLength });
  for (const part of parts) {
    if (fetchPart) {
      // Resilient path: the loader writes straight into the final allocation, with retries,
      // stall detection and alternate hosts. Same size checks as the streaming path below.
      const start = offset, uri = new URL(part.uri, baseUrl).href;
      const { bytes } = await fetchPart(uri, { buffer: output, offset, expected: part.byteLength ?? null });
      offset += bytes.byteLength;
      onProgress?.({ loaded: offset, total: byteLength });
      if (part.byteLength != null && offset - start !== part.byteLength) throw new Error(`collision BVH size mismatch: ${part.uri}`);
      continue;
    }
    const response = await fetch(new URL(part.uri, baseUrl));
    if (!response.ok) throw new Error(`collision BVH HTTP ${response.status}: ${part.uri}`);
    const start = offset;
    const append = bytes => {
      if (offset + bytes.byteLength > byteLength || part.byteLength != null && offset - start + bytes.byteLength > part.byteLength) {
        throw new Error(`collision BVH size mismatch: ${part.uri}`);
      }
      output.set(bytes, offset);
      offset += bytes.byteLength;
      onProgress?.({ loaded: offset, total: byteLength });
    };
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          append(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally { reader.releaseLock(); }
    } else append(new Uint8Array(await response.arrayBuffer()));
    if (part.byteLength != null && offset - start !== part.byteLength) throw new Error(`collision BVH size mismatch: ${part.uri}`);
  }
  if (offset !== byteLength) throw new Error('collision BVH total size mismatch');
  return output.buffer;
}

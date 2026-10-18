export const PAGE_SIZE = 12;

const SKETCHFAB = 'https://api.sketchfab.com/v3';
const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

const defaultFetch = (...args) => globalThis.fetch(...args);

export const isModelUrl = text => /^https?:\/\/\S+\.(?:glb|gltf)(?:\?\S*)?$/i.test(String(text).trim());

function thumbnail(images = [], target = 256) {
  const sorted = [...images].sort((a, b) => a.width - b.width);
  return (sorted.find(image => image.width >= target) ?? sorted.at(-1))?.url ?? '';
}

const largest = (images = []) => [...images].sort((a, b) => b.width - a.width)[0]?.url ?? '';

export const sketchfab = {
  id: 'sketchfab',
  label: 'Sketchfab',
  needsToken: true,
  async search({ query = '', cursor = null, fetchImpl = defaultFetch, signal } = {}) {
    const params = new URLSearchParams({ type: 'models', q: query.trim() || 'level map', downloadable: 'true', count: String(PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const response = await fetchImpl(`${SKETCHFAB}/search?${params}`, { signal });
    if (!response.ok) throw new Error(`Sketchfab search failed (${response.status}).`);
    const body = await response.json();
    let next = body.cursors?.next ?? null;
    if (!next && body.next) next = new URL(body.next).searchParams.get('cursor');
    const items = (body.results ?? []).map(model => ({
      id: model.uid,
      name: model.name ?? 'Untitled',
      author: model.user?.displayName ?? model.user?.username ?? '',
      license: model.license?.label ?? model.license?.slug ?? '',
      detail: model.faceCount ? `${model.faceCount >= 1000 ? Math.round(model.faceCount / 1000) + 'k' : model.faceCount} faces` : '',
      thumb: thumbnail(model.thumbnails?.images, 160),
      art: largest(model.thumbnails?.images),
      source: 'sketchfab',
    }));
    return { items, next };
  },
  play: (item, token) => ({ source: 'sketchfab', uid: item.id, token }),
};

let khronosIndex = null;

export const khronos = {
  id: 'khronos',
  label: 'glTF samples (no key needed)',
  needsToken: false,
  async search({ query = '', cursor = null, fetchImpl = defaultFetch, signal } = {}) {
    khronosIndex ??= fetchImpl(`${KHRONOS}/model-index.json`, { signal })
      .then(response => {
        if (!response.ok) throw new Error(`Sample list failed (${response.status}).`);
        return response.json();
      })
      .catch(error => {
        khronosIndex = null;
        throw error;
      });
    const all = await khronosIndex;
    const needle = query.trim().toLowerCase();
    const matches = all
      .filter(entry => !needle || [entry.label, entry.name, ...(entry.tags ?? [])].some(text => String(text ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => String(a.label ?? a.name).localeCompare(String(b.label ?? b.name)));
    const offset = Number(cursor) || 0;
    const page = matches.slice(offset, offset + PAGE_SIZE);
    const items = page.map(entry => {
      const variant = ['glTF-Binary', 'glTF', 'glTF-Embedded'].find(key => entry.variants?.[key]);
      return {
        id: entry.name,
        name: entry.label ?? entry.name,
        author: 'Khronos glTF Sample Assets',
        license: '',
        detail: (entry.tags ?? []).slice(0, 2).join(', '),
        thumb: entry.screenshot || entry.thumbnail ? `${KHRONOS}/${entry.name}/${entry.screenshot ?? entry.thumbnail}` : '',
        art: entry.screenshot || entry.thumbnail ? `${KHRONOS}/${entry.name}/${entry.screenshot ?? entry.thumbnail}` : '',
        url: variant ? `${KHRONOS}/${entry.name}/${variant}/${entry.variants[variant]}` : '',
        source: 'khronos',
      };
    }).filter(item => item.url);
    return { items, next: offset + PAGE_SIZE < matches.length ? String(offset + PAGE_SIZE) : null };
  },
  play: item => ({ source: 'url', url: item.url }),
};

export const PROVIDERS = [sketchfab, khronos];
export const providerById = id => PROVIDERS.find(provider => provider.id === id) ?? PROVIDERS[0];

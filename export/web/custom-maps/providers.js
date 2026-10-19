export const PAGE_SIZE = 12;

const SKETCHFAB = 'https://api.sketchfab.com/v3';
const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

const defaultFetch = (...args) => globalThis.fetch(...args);

export const isModelUrl = text => /^https?:\/\/\S+\.(?:glb|gltf|bsp)(?:\?\S*)?$/i.test(String(text).trim());

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


const BSP_INDEX = new URL('../maps/bsp/maps.json', import.meta.url).href;
const POLY = 'https://api.polyhaven.com';
let bspIndex = null, polyIndex = null;

const sizeLabel = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
const page = (list, cursor) => {
  const offset = Number(cursor) || 0;
  return { slice: list.slice(offset, offset + PAGE_SIZE), next: offset + PAGE_SIZE < list.length ? String(offset + PAGE_SIZE) : null };
};

// The NZ:P maps shipped in maps/bsp, listed by maps/bsp/maps.json (npm run build:bsp-index).
export const bsp = {
  id: 'bsp',
  label: 'NZ:P maps (BSP, built in)',
  needsToken: false,
  async search({ query = '', cursor = null, fetchImpl = defaultFetch, signal } = {}) {
    bspIndex ??= fetchImpl(BSP_INDEX, { signal })
      .then(response => {
        if (!response.ok) throw new Error(`Map list failed (${response.status}).`);
        return response.json();
      })
      .catch(error => {
        bspIndex = null;
        throw error;
      });
    const all = (await bspIndex).maps ?? [];
    const needle = query.trim().toLowerCase();
    const matches = all.filter(map => !needle || [map.title, map.id, map.author, map.description].some(text => String(text ?? '').toLowerCase().includes(needle)));
    const { slice, next } = page(matches, cursor);
    return {
      items: slice.map(map => ({
        id: map.id,
        name: map.title,
        author: map.author,
        license: '',
        detail: [map.description, `${map.perks ?? 0} perks`, sizeLabel(map.size)].filter(Boolean).join(' · '),
        thumb: map.art ? new URL(`../${map.art}`, import.meta.url).href : '',
        art: map.art ? new URL(`../${map.art}`, import.meta.url).href : '',
        url: new URL(`../maps/bsp/${map.file}`, import.meta.url).href,
        source: 'bsp',
      })),
      next,
    };
  },
  play: item => ({ source: 'bsp', url: item.url }),
};

// Poly Haven: CC0 glTF models, no key and no sign-up.
export const polyhaven = {
  id: 'polyhaven',
  label: 'Poly Haven (CC0, no key needed)',
  needsToken: false,
  async search({ query = '', cursor = null, fetchImpl = defaultFetch, signal } = {}) {
    polyIndex ??= fetchImpl(`${POLY}/assets?t=models`, { signal })
      .then(response => {
        if (!response.ok) throw new Error(`Poly Haven search failed (${response.status}).`);
        return response.json();
      })
      .catch(error => {
        polyIndex = null;
        throw error;
      });
    const all = Object.entries(await polyIndex).map(([id, asset]) => ({ id, ...asset }));
    const needle = query.trim().toLowerCase();
    const matches = all
      .filter(asset => !needle || [asset.name, asset.id, ...(asset.tags ?? []), ...(asset.categories ?? [])].some(text => String(text ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => (b.download_count ?? 0) - (a.download_count ?? 0));
    const { slice, next } = page(matches, cursor);
    return {
      items: slice.map(asset => ({
        id: asset.id,
        name: asset.name ?? asset.id,
        author: Object.keys(asset.authors ?? {}).join(', ') || 'Poly Haven',
        license: 'CC0',
        detail: (asset.categories ?? []).slice(0, 2).join(', '),
        thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${asset.id}.png?width=256&height=144`,
        art: `https://cdn.polyhaven.com/asset_img/thumbs/${asset.id}.png?width=1024&height=576`,
        source: 'polyhaven',
      })),
      next,
    };
  },
  async play(item, token, fetchImpl = defaultFetch) {
    const response = await fetchImpl(`${POLY}/files/${encodeURIComponent(item.id)}`);
    if (!response.ok) throw new Error(`Poly Haven file lookup failed (${response.status}).`);
    const files = await response.json();
    const resolution = ['1k', '2k', '4k'].find(key => files.gltf?.[key]?.gltf?.url);
    const entry = resolution && files.gltf[resolution].gltf;
    if (!entry) throw new Error('This Poly Haven model has no glTF download.');
    const include = Object.fromEntries(Object.entries(entry.include ?? {}).map(([name, file]) => [name, file.url]));
    return { source: 'url', url: entry.url, include };
  },
};

const WORKSHOP_INDEX = new URL('../maps/workshop/index.json', import.meta.url).href;
let workshopIndex = null;

const compact = value => (value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value));

export const workshop = {
  id: 'workshop',
  label: 'Black Ops 3 Workshop (no key needed)',
  needsToken: false,
  hint: 'Pick a map to open it on the Steam Workshop, then subscribe to it in Black Ops 3.',
  async search({ query = '', cursor = null, fetchImpl = defaultFetch, signal } = {}) {
    workshopIndex ??= fetchImpl(WORKSHOP_INDEX, { signal })
      .then(response => {
        if (!response.ok) throw new Error(`Workshop list failed (${response.status}).`);
        return response.json();
      })
      .catch(error => {
        workshopIndex = null;
        throw error;
      });
    const all = (await workshopIndex).items ?? [];
    if (!all.length) {
      workshopIndex = null;
      throw new Error('The Workshop list has not been generated yet. Run the "Workshop index" action on GitHub once.');
    }
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = all.filter(entry => {
      const haystack = [entry.name, entry.author, ...(entry.tags ?? [])].join(' ').toLowerCase();
      return words.every(word => haystack.includes(word));
    });
    const { slice, next } = page(matches, cursor);
    const items = slice.map(entry => ({
      id: entry.id,
      name: entry.name,
      author: entry.author ?? '',
      license: '',
      detail: [
        (entry.tags ?? []).slice(0, 2).join(', '),
        entry.subscribers ? `${compact(entry.subscribers)} subscribers` : '',
        entry.size ? sizeLabel(entry.size) : '',
      ].filter(Boolean).join(' · '),
      thumb: entry.thumb ?? '',
      art: entry.thumb ?? '',
      source: 'workshop',
    }));
    return { items, next };
  },
  play: item => ({ external: `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(item.id)}` }),
};

export const PROVIDERS = [bsp, workshop, polyhaven, khronos, sketchfab];
export const providerById = id => PROVIDERS.find(provider => provider.id === id) ?? PROVIDERS[0];

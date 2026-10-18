import { createSurvivalMap } from './survival-map.js';
import { loadCustomModel } from '../custom-maps/loader.js';
import { createCustomWorld } from '../custom-maps/world.js';
import { CustomSession, CustomFeatures, createGridNavigation } from '../custom-maps/runtime.js';

export async function mount(ctx) {
  const params = ctx.params ?? {};
  let layout = null;
  const map = createSurvivalMap({
    id: 'custom-map',
    label: ctx.label,
    base: './custom-maps',
    skyBase: './shangri-la',
    buildWorld: async () => {
      ctx.progress(`Downloading ${ctx.label}…`, .05);
      const root = await loadCustomModel(params, (loaded, total) => {
        if (total) ctx.progress(`Downloading ${ctx.label}… ${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`, .05 + .15 * Math.min(1, loaded / total));
      });
      const world = await createCustomWorld(root, { label: ctx.label, scale: params.scale ?? null, onStatus: (text, fraction) => ctx.progress(`${text}`, fraction) });
      layout = world.layout;
      return world;
    },
    packs: [mobile => `asset-pack/kino-${mobile ? 'mobile' : 'desktop'}.pack`, 'asset-pack/moon.pack'],
    blood: true,
    classes: { session: CustomSession, features: CustomFeatures, navigation: createGridNavigation(() => layout) },
    startHint: '500 points. M1911. Zombies break in through the boarded windows. Perks, Pack-a-Punch and the Mystery Box are placed for you.',
  });
  return map.mount(ctx);
}

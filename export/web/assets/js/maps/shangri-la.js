import { createSurvivalMap } from './survival-map.js';
import { buildShangriLayout, createShangriNavigation } from '../shangri-la-grid.js';
let layout = null;
const map = createSurvivalMap({
  id: 'shangri-la',
  label: 'Shangri-La',
  blood: true,
  base: './shangri-la',
  scanLayout: async ({ collision, data, barriers, doorParts, onStatus }) => {
    layout = await buildShangriLayout({ collision, entities: data.entities, spawn: data.spawn.position, barriers, doorParts, onStatus });
  },
  classes: { navigation: createShangriNavigation(() => layout) },
});

export async function mount(ctx) { return map.mount(ctx); }

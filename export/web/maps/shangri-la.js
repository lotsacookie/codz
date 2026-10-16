import { createSurvivalMap } from './survival-map.js';

// Shangri-La is entirely data: the shared survival runtime (survival-map.js) does the rest.
// To add a map with the same entity conventions, copy this file, change the values below
// and add one button to index.html (or run `node .tools/new-map.mjs <id> "<Label>"`).
const map = createSurvivalMap({
  id: 'shangri-la',
  label: 'Shangri-La',
  base: './shangri-la',
});

export async function mount(ctx) { return map.mount(ctx); }

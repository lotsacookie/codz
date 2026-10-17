import { createSurvivalMap } from './survival-map.js';
import { buildWorld } from '../one-window-challenge-world.js';
import { OneWindowSession, OneWindowFeatures, PathPointNavigation } from '../one-window-challenge.js';

const map = createSurvivalMap({
  id: 'one-window-challenge',
  label: 'One Window Challenge',
  base: './one-window-challenge',
  skyBase: './shangri-la',
  buildWorld,
  blood: true,
  classes: { session: OneWindowSession, features: OneWindowFeatures, navigation: PathPointNavigation },
  startHint: '500 points. M1911. One window, every perk, Pack-a-Punch and a single Mystery Box. Hold the window as long as you can.',
});

export async function mount(ctx) { return map.mount(ctx); }

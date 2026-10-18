import { AutoGraphics, gpuName } from './graphics.js';
import { AdaptiveResolution } from './quality.js';

export const EXPLORE_MAX_PIXEL_RATIO = 1.25;
export const EXPLORE_MIN_SCALE = .75;

export function bindExploreGraphics({ ctx, renderer, camera, maxPixelRatio, baseFar, targetMs = 1000 / 60 }) {
  const graphics = ctx.useGraphics();
  graphics.assessGpu(gpuName(renderer.getContext()));
  const auto = new AutoGraphics({ targetMs });
  const adapt = new AdaptiveResolution({ min: EXPLORE_MIN_SCALE, targetMs, enabled: !/[?&]adaptive=0\b/.test(globalThis.location?.search ?? '') });
  const ratio = () => maxPixelRatio * graphics.preset.resolution;
  function apply() {
    const preset = graphics.preset;
    renderer.setPixelRatio(ratio());
    camera.far = baseFar * preset.farScale;
    camera.updateProjectionMatrix();
    auto.reset();
    adapt.scale = adapt.max;
    adapt.stable = 0;
    adapt.probed = false;
    adapt.holdWindows = 4;
  }
  const stop = graphics.onChange(apply);
  ctx.onDispose(stop);
  apply();
  return {
    graphics,
    adapt,
    sample(deltaMs) {
      const scale = adapt.sample(deltaMs);
      if (scale !== null) renderer.setPixelRatio(ratio() * scale);
      if (graphics.setting === 'auto' && auto.sample(deltaMs, adapt.scale < adapt.max - .15)) graphics.stepDown();
    },
  };
}

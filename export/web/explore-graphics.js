import { AutoGraphics, gpuName } from './graphics.js';

export function bindExploreGraphics({ ctx, renderer, camera, maxPixelRatio, baseFar, targetMs = 1000 / 60 }) {
  const graphics = ctx.useGraphics();
  graphics.assessGpu(gpuName(renderer.getContext()));
  const auto = new AutoGraphics({ targetMs });
  function apply() {
    const preset = graphics.preset;
    renderer.setPixelRatio(maxPixelRatio * preset.resolution);
    camera.far = baseFar * preset.farScale;
    camera.updateProjectionMatrix();
    auto.reset();
  }
  const stop = graphics.onChange(apply);
  ctx.onDispose(stop);
  apply();
  return {
    graphics,
    sample(deltaMs) {
      if (graphics.setting === 'auto' && auto.sample(deltaMs)) graphics.stepDown();
    },
  };
}

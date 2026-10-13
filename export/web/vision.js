export const THEATER_VISION = Object.freeze({
  filmMidStart: 0.182469,
  filmMidEnd: 0.463125,
  filmDarkFeather: 0.6,
  filmLightFeather: 0.6,
  filmColorTemp: Object.freeze([6401.7251, 6484.1797, 5992.3706]),
  filmSaturation: Object.freeze([0.6737, 0.7509, 0.6105]),
  filmDarkTint: Object.freeze([0.8843, 0.9473, 1.0106]),
  filmMidTint: Object.freeze([1.0101, 1.0101, 1.0314]),
  filmLightTint: Object.freeze([0.9996, 0.9996, 1.0101]),
  filmContrast: Object.freeze([1.0176, 1.0176, 1.0176])
});

export const THEATER_FOG = Object.freeze({
  startDist: 155.625,
  halfDist: 2332.79
});

export const THEATER_BLOOM = Object.freeze({
  colorScale: 0.519,
  blurRadius: 1.75,
  breakpoint: 0.4947
});

export const THEATER_WORLD = Object.freeze({
  ambientColor: Object.freeze([0.5960, 0.6078, 0.6196]),
  sunColor: Object.freeze([0.82, 0.76, 0.62]),
  sunAngles: Object.freeze({ yaw: -48.9, pitch: -74.2 }),
  cgFov: 65
});

export const REFERENCE_TEMPERATURE = 6500;

export function sunTravelDirection({ yaw, pitch } = THEATER_WORLD.sunAngles) {
  const p = pitch * Math.PI / 180;
  const y = yaw * Math.PI / 180;
  const towardSun = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
  return [-towardSun[0], -towardSun[2], towardSun[1]];
}

export function verticalFovFromCgFov(cgFov) {
  return 2 * Math.atan(Math.tan(cgFov * Math.PI / 360) * 0.75) * 180 / Math.PI;
}

export function gradeUniforms(vision = THEATER_VISION) {
  return {
    whiteBalance: vision.filmColorTemp.map(temperature => REFERENCE_TEMPERATURE / temperature),
    saturation: [...vision.filmSaturation],
    darkTint: [...vision.filmDarkTint],
    midTint: [...vision.filmMidTint],
    lightTint: [...vision.filmLightTint],
    contrast: [...vision.filmContrast],
    region: [vision.filmMidStart, vision.filmMidEnd, vision.filmDarkFeather, vision.filmLightFeather]
  };
}

export function fogDensityFromHalfDistance(halfDistance) {
  return Math.LN2 / halfDistance;
}

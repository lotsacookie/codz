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

export const REFERENCE_TEMPERATURE = 6500;

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

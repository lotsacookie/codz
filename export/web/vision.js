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
export const MIDDLE_GRAY = 0.18;
export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

const clamp01 = value => Math.min(1, Math.max(0, value));

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
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

export function tintWeights(luma, region = gradeUniforms().region) {
  const [midStart, midEnd, darkFeather, lightFeather] = region;
  const v = luma / (1 + luma);
  const dark = 1 - smoothstep(midStart * (1 - darkFeather), midStart * (1 + darkFeather), v);
  const light = smoothstep(midEnd * (1 - lightFeather), midEnd * (1 + lightFeather), v);
  const mid = Math.max(0, 1 - dark - light);
  const total = dark + mid + light;
  return { dark: dark / total, mid: mid / total, light: light / total };
}

export function fogDensityFromHalfDistance(halfDistance) {
  return Math.LN2 / halfDistance;
}

const ACES_INPUT = [
  [0.59719, 0.35458, 0.04823],
  [0.07600, 0.90834, 0.01566],
  [0.02840, 0.13383, 0.83777]
];
const ACES_OUTPUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602]
];

const multiply = (matrix, v) => matrix.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

export function acesFilmic(rgb, exposure) {
  const scaled = rgb.map(value => value * exposure / 0.6);
  const fitted = multiply(ACES_INPUT, scaled).map(x => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.983729 * x + 0.4329510) + 0.238081;
    return a / b;
  });
  return multiply(ACES_OUTPUT, fitted).map(clamp01);
}

export function displayPreimage(target, exposure, iterations = 24) {
  const x = target.map(value => Math.max(0, value));
  const h = 1e-5;
  for (let i = 0; i < iterations; i++) {
    const y = acesFilmic(x, exposure);
    for (let c = 0; c < 3; c++) {
      const probe = x.slice();
      probe[c] += h;
      const slope = (acesFilmic(probe, exposure)[c] - y[c]) / h;
      x[c] = Math.max(0, x[c] + (target[c] - y[c]) / Math.max(slope, 1e-3));
    }
  }
  return x;
}

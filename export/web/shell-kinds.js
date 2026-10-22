// Which weapon kinds eject which reference shell casing (pure data, no three.js).
export const SHELLS = Object.freeze({
  pistol: { model: 'pistol', texture: '~-gfx_shell_col.png', tint: 0xc9a24f, scale: 0.8, speed: 62, life: 1.1 },
  shotgun: { model: 'shotgun', texture: '~-gfx_shotgun_shell_col.png', tint: 0xb02a22, scale: 0.8, speed: 54, life: 1.3 },
});
export const ENABLED = Object.freeze(['pistol', 'shotgun']);

/** Shell kind a weapon FX profile ejects, or null. */
export function shellKindFor(profile) {
  const kind = profile?.kind;
  return kind && ENABLED.includes(kind) && SHELLS[kind] ? kind : null;
}

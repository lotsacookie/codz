// Which weapon kinds eject which reference shell casing (pure data, no three.js).
export const SHELLS = Object.freeze({
  pistol: { model: 'pistol', texture: '~-gfx_shell_col.png', tint: 0xc9a24f, scale: 0.8, speed: 62, life: 1.1 },
  rifle: { model: 'rifle', texture: '~-gfx_shell_col.png', tint: 0xc9a24f, scale: 0.8, speed: 66, life: 1.1 },
  link: { model: 'chain', texture: '~-gfx_bullet_chain_col.png', tint: 0x8a8a80, scale: 0.8, speed: 38, life: 1.0 },
  shotgun: { model: 'shotgun', texture: '~-gfx_shotgun_shell_col.png', tint: 0xb02a22, scale: 0.8, speed: 54, life: 1.3 },
});
export const ENABLED = Object.freeze(['pistol', 'rifle', 'link', 'shotgun']);

// Reference fx_pistol (pistols, SMGs), fx_rifle (rifles, LMGs) and fx_shotgun. Revolvers (fx_revolver)
// only dump casings on reload and bolt-action snipers on the bolt cycle, so they eject nothing per shot.
const BY_PROFILE = Object.freeze({ pistol: 'pistol', smg: 'pistol', rifle: 'rifle', lmg: 'rifle', shotgun: 'shotgun' });

/** Shell kind a weapon FX profile ejects, or null. */
export function shellKindFor(profile) {
  if (!profile || profile.revolver) return null;
  const kind = BY_PROFILE[profile.kind];
  return kind && ENABLED.includes(kind) && SHELLS[kind] ? kind : null;
}

/** Belt-fed machine guns (fx_heavy_link_view) also eject a bullet chain link. */
export function linkKindFor(profile) {
  return profile?.kind === 'lmg' ? 'link' : null;
}

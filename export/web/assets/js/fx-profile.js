const NONE = /ray_gun|raygun|thundergun|crossbow|knife|microwave|china_lake|launcher|grenade|bottle|sword|sliquifier|freeze|shrink|tesla|bowie|wave|monkey|claymore/i;

const CLASSES = [
  ['shotgun', /rottweil|ithaca|spas|hs10|olympia|shotgun/i, { size: 11, puffs: 4, life: 1.5, speed: 95, alpha: 0.34 }],
  ['lmg', /hk21|rpk|rpd|m60|stoner|lmg/i, { size: 9, puffs: 3, life: 1.35, speed: 80, alpha: 0.3 }],
  ['sniper', /dragunov|l96|psg|wa2000|sniper/i, { size: 10, puffs: 3, life: 1.45, speed: 70, alpha: 0.32 }],
  ['pistol', /m1911|python|cz75|makarov|357|pistol|colt/i, { size: 5, puffs: 2, life: 1.1, speed: 60, alpha: 0.26 }],
  ['smg', /mp40|mp5|mpl|pm63|ak74u|g11|spectre|uzi|skorpion|kiparis|smg/i, { size: 6.5, puffs: 2, life: 1.15, speed: 70, alpha: 0.27 }]
];

const RIFLE = { size: 8, puffs: 2, life: 1.25, speed: 75, alpha: 0.3 };

export function weaponFxProfile(def) {
  if (!def?.id) return null;
  if (NONE.test(def.id)) return null;
  if (def.attachmentActive && def.projectileSpeed > 0) return null;
  const found = CLASSES.find(([, pattern]) => pattern.test(def.id));
  const base = found ? found[2] : RIFLE;
  const scale = def.upgraded ? 1.15 : 1;
  return {
    kind: found ? found[0] : 'rifle',
    revolver: /python|357|revolver/i.test(def.id),
    upgraded: !!def.upgraded,
    size: base.size * scale,
    puffs: base.puffs + (def.upgraded ? 1 : 0),
    smokeLife: base.life,
    smokeSpeed: base.speed,
    smokeAlpha: base.alpha
  };
}

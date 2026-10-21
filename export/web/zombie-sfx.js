// Zombie voice cues from the reference sound map (ref/vox/zmb/...), grouped by enemy kind and action.
// 'nova' is the crawling quad; the quads only have one ambient set, shared by walking and sprinting.
export function zombieCues(keys) {
  const by = prefix => keys.filter(key => key.startsWith('ref/vox/zmb/' + prefix + '/'));
  return {
    zombie: {
      walk: by('standard/amb'), sprint: by('standard/sprint'), crawl: by('standard/crawl'), attack: by('standard/attack'),
      death: by('standard/death'), behind: by('standard/behind'), taunt: by('standard/taunt'), elec: by('standard/elec'),
    },
    nova: { walk: by('quads/ambient'), sprint: by('quads/ambient'), attack: by('quads/attack'), death: by('quads/death'), spawn: by('quads/spawn') },
  };
}

export function preloadZombieKeys(cues) {
  return [cues.zombie.walk, cues.zombie.sprint, cues.zombie.attack, cues.zombie.death, cues.nova.walk, cues.nova.attack, cues.nova.death].flat();
}

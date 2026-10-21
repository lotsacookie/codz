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

export function dogCues(keys) {
  const by = prefix => keys.filter(key => key.startsWith(prefix));
  const vox = 'ref/evt/zombie_tron/hellhounds/vox/', global = 'ref/evt/zombie_global/hellhounds/';
  return {
    walk: by(vox + 'move/'), sprint: by(vox + 'move/'), close: [...by(vox + 'close/'), ...by('ref/aml/dog/close/')], attack: [...by(vox + 'attack/'), ...by('ref/aml/dog/bark/')],
    bite: by(vox + 'bite/'), death: [...by(vox + 'death/'), ...by('ref/aml/dog/death/')], step: by(global + 'step/'), collar: by('ref/aml/dog/run_collar/'),
    spawn: [...by(global + 'spawn/pre_spawn'), ...by(global + 'spawn/spawn_01'), ...by(global + 'spawn/strikes_00')], explode: by('ref/evt/zombie_tron/hellhounds/explode/'),
  };
}

export function preloadZombieKeys(cues) {
  return [cues.zombie.walk, cues.zombie.sprint, cues.zombie.attack, cues.zombie.death, cues.nova.walk, cues.nova.attack, cues.nova.death].flat();
}

export function preloadDogKeys(dog) {
  return [dog.walk, dog.close, dog.attack, dog.bite, dog.death, dog.step, dog.collar, dog.spawn].flat();
}

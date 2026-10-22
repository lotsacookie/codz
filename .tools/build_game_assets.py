"""Build browser assets from local OAT dumps; never modifies the fastfiles."""
import csv, hashlib, json, math, pathlib, re, shutil, struct, subprocess
from urllib.parse import quote
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'export/web/assets'
ZONES = [ROOT / 'export_game' / z for z in ['common', 'common_zombie', 'zombie_theater', 'en_common_zombie', 'en_zombie_theater', 'common_zombie_patch', 'zombie_theater_patch']]
for sub in ['models', 'animations', 'textures/game', 'audio']:
    (OUT / sub).mkdir(parents=True, exist_ok=True)

def find(rel):
    return next((z / rel for z in reversed(ZONES) if (z / rel).is_file()), None)

def pos(text):
    x, y, z = map(float, text.split())
    return [x, z, -y]

ents_path = ROOT / 'export_fmtprobe/maps/zombie_theater.d3dbsp.ents'
ents = [dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', s)) for s in re.findall(r'\{([^{}]*)\}', ents_path.read_text())]
world = json.loads((ROOT / 'export/maps/zombie_theater.d3dbsp.gfxworld.json').read_text())
for i, e in enumerate(ents):
    e['id'] = i
    if 'origin' in e: e['position'] = pos(e['origin'])
    e['yaw'] = math.radians(float(e.get('angles', '0 0 0').split()[1]))
    if e.get('model', '').startswith('*'):
        bm = world['brushModels'][int(e['model'][1:])]
        lo, hi = bm['mins'], bm['maxs']
        o = e.get('position', [0, 0, 0])
        e['bounds'] = [[lo[0]+o[0], lo[2]+o[1], -hi[1]+o[2]], [hi[0]+o[0], hi[2]+o[1], -lo[1]+o[2]]]

texture_index = {}
for z in [ROOT/'export', ROOT/'export_cz', *ZONES]:
    for p in (z/'images').glob('*.dds'): texture_index[p.stem] = p
converted, missing = {}, set()

def texture(name):
    name = pathlib.PurePosixPath(name.replace('\\', '/')).stem
    if name in converted: return converted[name]
    source = texture_index.get(name) or texture_index.get('~-g'+name)
    if not source:
        existing = OUT / 'textures' / (name+'.png')
        if existing.exists(): return '../textures/'+quote(existing.name)
        missing.add(name)
        return None
    target = OUT/'textures/game'/(source.stem+'.webp')
    if not target.exists():
        try:
            im = Image.open(source).convert('RGBA')
            im.thumbnail((1024, 1024))
            im.save(target, 'WEBP', quality=88)
        except Exception as exc:
            missing.add(name)
            print('Texture conversion failed', name, exc)
            return None
    converted[name] = '../textures/game/'+quote(target.name)
    return converted[name]

def model(name):
    name = name.lstrip(',')
    source = find('model_export/'+name+'_lod0.glb')
    if not source: return None
    b = source.read_bytes()
    n = struct.unpack_from('<I', b, 12)[0]
    doc = json.loads(b[20:20+n])
    old_images, old_textures = doc.get('images', []), doc.get('textures', [])
    # Rebuild texture slots from the separately dumped material definitions.
    # Dependencies may be references when the model's own fastfile is dumped.
    doc['images'], doc['textures'] = [], []
    doc['samplers'] = [{'wrapS':10497,'wrapT':10497,'magFilter':9729,'minFilter':9987}]
    for m in doc.get('materials', []):
        original_color = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        original_uri = old_images[old_textures[original_color['index']]['source']].get('uri') if original_color else None
        m.pop('normalTexture', None)
        m.pop('occlusionTexture', None)
        m['pbrMetallicRoughness'] = {'metallicFactor': 0, 'roughnessFactor': .82}
        p = find('materials/'+m['name']+'.json')
        mat = json.loads(p.read_text()) if p else {}
        slots = mat.get('textures', [])
        color = next((t.get('image') for t in slots if t.get('name') == 'colorMap'), None)
        # Shared zombie clothing shaders have their albedo under a custom slot.
        if not color:
            color = next((t.get('image') for t in slots if 'color' in t.get('name','').lower()), None)
        if not color and 'honorguard' in m['name']: color = '~-gchar_ger_honorguard_body1_c'
        if not color and original_uri: color = original_uri
        uri = texture(color) if color else None
        if uri:
            ix = len(doc['images'])
            doc['images'].append({'uri':uri})
            doc['textures'].append({'source':ix,'sampler':0})
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index':ix}
        elif 'metal' in m['name']: m['pbrMetallicRoughness']['baseColorFactor']=[.17,.17,.16,1]
        # Multiplayer customization surfaces are intentionally empty in solo.
        # Without the runtime emblem/font textures, opaque defaults make white
        # rectangles on otherwise complete weapon models.
        if m['name'] in ['mc/mtl_player_icon', 'mc/mtl_clan_tag']:
            m['alphaMode']='BLEND'
            m['pbrMetallicRoughness']['baseColorFactor']=[1,1,1,0]
        if 'eyes' in m['name']: m['emissiveFactor']=[1,.45,.03]
    raw = json.dumps(doc,separators=(',',':')).encode()
    raw += b' ' * (-len(raw)%4)
    tail = b[20+n:]
    packed = struct.pack('<III',0x46546c67,2,20+len(raw)+len(tail))+struct.pack('<II',len(raw),0x4e4f534a)+raw+tail
    (OUT/'models'/(name+'.glb')).write_bytes(packed)
    return 'models/'+name+'.glb'

weapons = {}
weapons_script = find('maps/_zombiemode_weapons.gsc').read_text()
prices = dict(re.findall(r'add_zombie_weapon\(\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*&"[^"]*"\s*,\s*(\d+)', weapons_script))
names = {'m1911':'M1911','m14':'M14','rottweil72':'Olympia','ithaca':'Stakeout','mp40':'MP40','mp5k':'MP5K','mpl':'MPL','pm63':'PM63','ak74u':'AK-74u','m16':'M16','galil':'Galil','commando':'Commando','hk21':'HK21','rpk':'RPK','ray_gun':'Ray Gun','thundergun':'Thundergun','python':'Python','spas':'SPAS-12'}
names.update({'cz75':'CZ75','cz75dw':'CZ75 Dual Wield','g11_lps':'G11','famas':'FAMAS','spectre':'Spectre','hs10':'HS10','aug_acog':'AUG','fnfal':'FN FAL','dragunov':'Dragunov','l96a1':'L96A1','m72_law':'M72 LAW','china_lake':'China Lake','crossbow_explosive':'Crossbow','knife_ballistic':'Ballistic Knife'})
upgrade_names=dict(zip(names, ['Mustang & Sally','Mnesia','Hades','Raid','The Afterburner','MP115 Kollider','MPL-LF','Tokyo & Rose','AK74fu2','Skullcrusher','Lamentation','Predator','H115 Oscillator','R115 Resonator',"Porter's X2 Ray Gun",'Zeus Cannon','Cobra','SPAZ-24','Calamity','Calamity & Jane','G115 Generator','G16-GL35','Phantom','Typhoid & Mary','AUG-50M3','EPC WN','D115 Disassembler','L115 Isolator','M72 Anarchy','China Beach','Awful Lawton','The Krauss Refibrillator']))
animation_names = set()
ANIMATION_KEYS = ['idleAnim','emptyIdleAnim','fireAnim','lastShotAnim','adsFireAnim','adsLastShotAnim',
    'reloadAnim','reloadEmptyAnim','reloadStartAnim','reloadEndAnim',
    'raiseAnim','firstRaiseAnim','quickRaiseAnim','dropAnim','quickDropAnim',
    'sprintInAnim','sprintLoopAnim','sprintOutAnim','sprintInEmptyAnim','sprintLoopEmptyAnim','sprintOutEmptyAnim',
    'adsUpAnim','adsDownAnim','meleeAnim','meleeChargeAnim']
def weapon_animations(d):
    result = {}
    for key in [*ANIMATION_KEYS, *[k for k in d if k.endswith('AnimLeft')]]:
        if d.get(key) and find('xanim/'+d[key]):
            animation_names.add(d[key]); result[key] = 'animations/'+d[key]+'.json'
    return result

def weapon_sounds(d):
    return {k:v for k,v in d.items() if v and ('Sound' in k and k != 'notetrackSoundMap')}
def weapon_definition(name, label):
    p = find('weapons/'+name)
    if not p: raise RuntimeError('Missing weapon '+name)
    a = p.read_text().split('\\')
    d = dict(zip(a[1::2], a[2::2]))
    def num(k, default=0): return float(d.get(k) or default)
    clip = int(num('clipSize',8))
    ammo_factor = clip if d.get('ammoCountClipRelative') == '1' else 1
    clips = weapon_animations(d)
    result = {'id':name,'name':label,'price':int(prices.get(name,950)),
        'clipSize':clip,'startAmmo':int(num('startAmmo',4))*ammo_factor,'maxAmmo':int(num('maxAmmo',10))*ammo_factor,
        'damage':num('damage',20),'minDamage':num('minDamage',20),'range':num('maxDamageRange',500),
        'fireTime':num('fireTime',.15),'reloadTime':num('reloadTime',2),'reloadEmptyTime':num('reloadEmptyTime',2.5),
        'automatic': d.get('fireType') in ['Full Auto','Full auto','fullauto'], 'fireType':d.get('fireType'),
        'pellets':int(num('shotCount',1)), 'headMultiplier':num('locHead',4),
        'hideTags':d.get('hideTags','').split(),
        'explosionRadius':num('explosionRadius'), 'explosionInnerDamage':num('explosionInnerDamage'), 'explosionOuterDamage':num('explosionOuterDamage'), 'projectileSpeed':num('projectileSpeed'),
        'model':model(d['gunModel']) if d.get('gunModel') else None,'worldModel':model(d['worldModel']) if d.get('worldModel') else None,'animations':clips,
        'sounds':weapon_sounds(d), 'notetrackSounds':dict(re.findall(r'(\S+)\s+(\S+)',d.get('notetrackSoundMap',''))),
        'adsInTime':num('adsTransInTime',.2), 'adsOutTime':num('adsTransOutTime',.2), 'adsFov':num('adsZoomFov1',55),
        'raiseTime':num('raiseTime',.3), 'dropTime':num('dropTime',.2),
        'sprintInTime':num('sprintInTime',.3),'sprintLoopTime':num('sprintLoopTime',.7),'sprintOutTime':num('sprintOutTime',.3),
        'sprintOffset':[num('sprintOfsR'),num('sprintOfsU'),-num('sprintOfsF')],
        'sprintRotation':[math.radians(num('sprintRotP')),math.radians(num('sprintRotY')),math.radians(num('sprintRotR'))],
        'segmentedReload':d.get('segmentedReload')=='1','reloadAmmoAdd':int(num('reloadAmmoAdd',1)),
        'reloadStartAdd':int(num('reloadStartAdd')),'reloadStartTime':num('reloadStartTime'),
        'reloadEndTime':num('reloadEndTime')}
    result.update({'projectileLifetime':num('projectileLifetime',8),'projectileSpeedUp':num('projectileSpeedUp'),
        'projectileType':d.get('projExplosionType'),'projectileModel':model(d['projectileModel']) if d.get('projectileModel') else None,
        'fuseTime':num('fuseTime'), 'dualWield':d.get('dualWield')=='1'})
    if name.startswith('knife_ballistic'):
        result['melee']={key:num(key) for key in ['meleeDamage','meleeDelay','meleeChargeDelay','meleeTime','meleeChargeTime']}
    if result['dualWield'] and d.get('DualWieldWeapon'):
        a=find('weapons/'+d['DualWieldWeapon']).read_text().split('\\'); left=dict(zip(a[1::2],a[2::2]))
        result['leftModel']=model(left['gunModel']); result['leftAnimations']=weapon_animations(left)
        result['clipSize']*=2
    # The crossbow launcher delegates its timed blast to a separate weapon.
    if name.startswith('crossbow_explosive'):
        bolt='explosive_bolt_upgraded_zm' if 'upgraded' in name else 'explosive_bolt_zm'
        a=find('weapons/'+bolt).read_text().split('\\'); bd=dict(zip(a[1::2],a[2::2]))
        for key in ['explosionRadius','explosionInnerDamage','explosionOuterDamage','fuseTime']:
            result[key]=float(bd.get(key) or 0)
        result['lure']='upgraded' in name
    return result

for base,label in names.items():
    name=base+'_zm'; weapons[name]=weapon_definition(name,label)
    upgraded={'m16':'m16_gl_upgraded_zm','aug_acog':'aug_acog_mk_upgraded_zm'}.get(base,base+'_upgraded_zm')
    u=weapon_definition(upgraded,upgrade_names[base])
    weapons[name]['upgrade']={k:v for k,v in u.items() if k not in ['id','price']}
    alt={'m16':'gl_m16_upgraded_zm','aug_acog':'mk_aug_upgraded_zm'}.get(base)
    if alt: weapons[name]['upgrade']['attachment']=weapon_definition(alt,'Grenade Launcher' if base=='m16' else 'Masterkey')

equipment={name:weapon_definition(name,label) for name,label in [('claymore_zm','Claymores'),('zombie_cymbal_monkey','Monkey Bombs')]}
map_script=find('maps/zombie_theater.gsc').read_text()
box_pool=re.findall(r'^\s*include_weapon\(\s*"([^\"]+)"\s*(?:,\s*true\s*)?\);',map_script,re.M)

perk_drinks = {}
for perk, suffix in [('specialty_quickrevive','revive'),('specialty_fastreload','sleight'),('specialty_rof','doubletap'),('specialty_armorvest','jugg')]:
    name = 'zombie_perk_bottle_'+suffix
    a = find('weapons/'+name).read_text().split('\\'); d = dict(zip(a[1::2],a[2::2]))
    perk_drinks[perk] = {'id':name,'model':model(d['gunModel']),'animations':weapon_animations(d),
        'raiseTime':float(d['firstRaiseTime']),'dropTime':float(d['dropTime']),
        'adsInTime':.2,'adsOutTime':.2,'sounds':weapon_sounds(d),
        'notetrackSounds':dict(re.findall(r'(\S+)\s+(\S+)',d.get('notetrackSoundMap','')))}

melee = {}
for key, name in [('knife','knife_zm'),('bowie','bowie_knife_zm')]:
    p = find('weapons/'+name)
    a = p.read_text().split('\\'); d = dict(zip(a[1::2],a[2::2]))
    melee[key] = {'id':name,'model':model(d['gunModel']),'animations':weapon_animations(d),
        'sounds':weapon_sounds(d),'damage':float(d['meleeDamage']),
        'delay':float(d['meleeDelay']),'chargeDelay':float(d['meleeChargeDelay']),
        'time':float(d['meleeTime']),'chargeTime':float(d['meleeChargeTime'])}

characters = {name:model(name) for name in ['c_ger_honorguard_body1','c_ger_honorguard_body2','c_ger_zombie_head1','c_ger_zombie_head2','c_ger_zombie_head3','c_ger_zombie_head4','c_zom_quad_body','c_zom_quad_head','zombie_wolf','viewhands_usmc','viewmodel_usa_pow_arms']}
actor_anims = ['ai_zombie_walk_v1','ai_zombie_walk_v2','ai_zombie_walk_fast_v1','ai_zombie_run_v1','ai_zombie_sprint_v1','ai_zombie_attack_v1','ai_zombie_attack_forward_v1','ai_zombie_death_v1']
actor_anims += ['ai_zombie_quad_crawl','ai_zombie_quad_crawl_run','ai_zombie_quad_crawl_sprint','ai_zombie_quad_attack','ai_zombie_quad_death']
actor_anims += [p.name for z in ZONES for p in (z/'xanim').glob('*dog*') if any(s in p.name for s in ['run','attack','death'])][:12]
actor_anims += ['zombie_dog_run', 'zombie_dog_run_attack', 'zombie_dog_death_front']
actor_anims += ['o_monkey_bomb']
for name in actor_anims:
    if find('xanim/'+name): animation_names.add(name)
animations = {}
for name in sorted(animation_names):
    p=find('xanim/'+name)
    target=OUT/'animations'/(name+'.json')
    if target.exists() and target.stat().st_mtime >= max(p.stat().st_mtime,(ROOT/'.tools/xanim_to_json.mjs').stat().st_mtime):
        animations[name]='animations/'+name+'.json'
        continue
    r=subprocess.run(['node', str(ROOT/'.tools/xanim_to_json.mjs'),str(p),'-o',str(OUT/'animations')], capture_output=True,text=True)
    if r.returncode: raise RuntimeError('Animation failed '+name+': '+r.stderr)
    else: animations[name]='animations/'+name+'.json'

# Script models include the perk machines, power lever, teleporter and chests.
models = {}
for e in ents:
    if e.get('classname') in ['script_model','misc_turret'] and not e.get('model','').startswith('*'):
        name=e.get('model','').lstrip(',')
        if name not in models: models[name]=model(name)

rows=list(csv.reader(find('mp/zombiemode.csv').read_text().splitlines()))
rules={r[0]:float(r[2]) for r in rows[1:] if len(r)>2 and re.fullmatch(r'-?\d+(\.\d+)?',r[2])}
for r in rows[1:]:
    if r[0] in weapons:
        if len(r)>1 and r[1].isdigit(): weapons[r[0]]['price']=int(r[1])
        if len(r)>2 and r[2].isdigit(): weapons[r[0]]['ammoPrice']=int(r[2])
map_script=find('maps/zombie_theater.gsc').read_text()
zone_links=re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"',map_script)
powerup_script = find('maps/_zombiemode_powerups.gsc').read_text()
included = re.findall(r'include_powerup\(\s*"([^"]+)"', map_script)
powerups = {}
labels = {'nuke':'Nuke','insta_kill':'Insta-Kill','double_points':'Double Points','full_ammo':'Max Ammo','carpenter':'Carpenter','fire_sale':'Fire Sale'}
hud_images = {'insta_kill':'specialty_instakill_zombies','double_points':'specialty_2x_zombies','fire_sale':'specialty_firesale_zombies'}
for key, model_name in re.findall(r'^\s*add_zombie_powerup\(\s*"([^"]+)"\s*,\s*"([^"]+)"', powerup_script, re.M):
    if key not in included: continue
    icon = texture(hud_images[key]) if key in hud_images else None
    powerups[key] = {'name':labels[key],'model':model(model_name),'icon':icon.removeprefix('../') if icon else None}
    if not powerups[key]['model']: raise RuntimeError('Missing powerup '+key)
for key, value in re.findall(r'set_zombie_var\(\s*"([^"]+)"\s*,\s*(\d+)\s*\)', powerup_script):
    rules[key] = float(value)
data={'coordinateSystem':'three-y-up','entities':ents,'weapons':weapons,'melee':melee,'perkDrinks':perk_drinks,'powerups':powerups,'boxTeddy':model('zombie_teddybear'),'characters':characters,'animations':animations,'models':models,'rules':rules,'zoneLinks':zone_links}
data.update({'equipment':equipment,'boxPool':box_pool,'reelModel':model('zombie_theater_reelcase_obj')})
data['filmAtlas']=texture('fxt_projector_screen').removeprefix('../')
(OUT/'game-data.json').write_text(json.dumps(data,separators=(',',':')))
report={'entities':len(ents),'weapons':len(weapons),'models':len([v for v in models.values() if v]),'animations':len(animations),'convertedTextures':len(converted),'missingTextures':sorted(missing),'sourceEntitySha256':hashlib.sha256(ents_path.read_bytes()).hexdigest()}
(OUT/'asset-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))

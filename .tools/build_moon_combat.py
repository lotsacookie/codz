"""Build native Moon actors; reuse already recovered common T5 weapon assets."""
import json
import math
from pathlib import Path
import re
import struct
import subprocess
from urllib.parse import quote
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'export/web/assets/moon'
ZONES = [ROOT/'export_game/common', ROOT/'export_game/common_zombie', ROOT/'export_game/en_common_zombie', ROOT/'export_moon/zombie_moon', ROOT/'export_moon/zombie_moon_patch']
ZONES += [ROOT/'export_moon/rigs/zombie_moon', ROOT/'export_moon/rigs/zombie_moon_patch']
for sub in ['models', 'textures/actors', 'animations']:
    (OUT/sub).mkdir(parents=True, exist_ok=True)
def find(rel):
    return next((z/rel for z in reversed(ZONES) if (z/rel).is_file()), None)

def model(name):
    name = name.lstrip(',')
    source = find('model_export/'+name+'_lod0.glb')
    if not source: raise RuntimeError(f'Missing Moon model {name}. Rebuild with -Extract.')
    b = source.read_bytes(); n = struct.unpack_from('<I', b, 12)[0]; doc = json.loads(b[20:20+n])
    doc['images'], doc['textures'] = [], []
    doc['samplers'] = [{'wrapS':10497,'wrapT':10497,'magFilter':9729,'minFilter':9987}]
    for m in doc.get('materials', []):
        m.pop('normalTexture', None); m.pop('occlusionTexture', None)
        m['pbrMetallicRoughness'] = {'metallicFactor':0, 'roughnessFactor':.85}
        p = find('materials/'+m['name']+'.json')
        definition = json.loads(p.read_text()) if p else {}
        slots = definition.get('textures', [])
        texture = next((s['image'] for key in ['colorMap', 'Diffuse_Map'] for s in slots if s.get('name') == key), None)
        if not texture: texture = next((s['image'] for s in slots if 'color' in s.get('name','').lower()), None)
        if not texture: texture = next((s['image'] for s in slots if s.get('semantic') == 'colorMap'), None)
        image = find('images/'+texture+'.dds') if texture else None
        if image:
            target = OUT/'textures/actors'/f'{texture}.webp'
            im = Image.open(image).convert('RGBA'); im.thumbnail((1024,1024)); im.save(target, 'WEBP', quality=90)
            index = len(doc['images']); doc['images'].append({'uri':'../textures/actors/'+quote(target.name)})
            doc['textures'].append({'source':index,'sampler':0})
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index':index}
        elif m['name'] in ['mc/mtl_player_icon', 'mc/mtl_clan_tag']:
            m['alphaMode'] = 'BLEND'; m['pbrMetallicRoughness']['baseColorFactor'] = [1,1,1,0]
        elif m['name'] == 'mc/lambert1':
            # Untextured interior cap in the original damaged-body mesh.
            m['pbrMetallicRoughness']['baseColorFactor'] = [.16,.08,.07,1]
        else: raise RuntimeError(f'Missing actor diffuse: {name} / {m["name"]} / {texture}')
        if 'eye' in m['name']: m['emissiveFactor'] = [1,.3,.01]
        if any(s.get('alphaTest','disabled') != 'disabled' for s in definition.get('stateBits', [])):
            m['alphaMode'] = 'MASK'; m['alphaCutoff'] = .45
    raw = json.dumps(doc,separators=(',',':')).encode(); raw += b' '*(-len(raw)%4)
    tail = b[20+n:]
    (OUT/'models'/f'{name}.glb').write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(tail))+struct.pack('<II',len(raw),0x4e4f534a)+raw+tail)
    return 'moon/models/'+name+'.glb'

kino = json.loads((ROOT/'export/web/assets/game-data.json').read_text())
map_data = json.loads((OUT/'map-data.json').read_text())
weapon_ids = {'m1911_zm'} | {e.get('zombie_weapon_upgrade') for e in map_data['entities']}
weapons = {k:v for k,v in kino['weapons'].items() if k != 'thundergun_zm'}
bodies = ['c_zom_moon_tech_body_shirtguts_1', 'c_zom_moon_tech_body_noshirtguts_2']
heads = [f'c_zom_moon_head{i}' for i in range(1,5)]
actor_models = {name:model(name) for name in [*bodies, *heads, 'c_zom_moon_militarypolice_body_bloat', 'c_zom_moon_pressure_suit_body_zombie', 'c_zom_moon_pressure_suit_helm', 'c_zom_quad_body_bloat', 'c_zom_quad_head_bloat']}
animations = {name:url for name,url in kino['animations'].items() if name.startswith(('ai_zombie_', 'zombie_dog_'))}
for name in ['ai_zombie_walk_moon_v1','ai_zombie_run_moon_v1','ai_zombie_run_moon_v2','ai_zombie_sprint_moon_v1']:
    source = ROOT/'export_moon/rigs/zombie_moon/xanim'/name
    subprocess.run(['node',str(ROOT/'.tools/xanim_to_json.mjs'),str(source),'-o',str(OUT/'animations')], check=True, capture_output=True)
    animations[name] = 'moon/animations/'+name+'.json'
def raw_weapon(name):
    p = find('weapons/'+name)
    if not p: raise RuntimeError('Missing weapon '+name)
    a = p.read_text().split('\\'); return dict(zip(a[1::2], a[2::2]))

def clips(d):
    result = {}
    for key, name in d.items():
        if not key.endswith(('Anim','AnimLeft')) or not name: continue
        source = find('xanim/'+name)
        if not source: continue
        if name not in animations:
            subprocess.run(['node',str(ROOT/'.tools/xanim_to_json.mjs'),str(source),'-o',str(OUT/'animations')],check=True,capture_output=True)
            animations[name] = 'moon/animations/'+name+'.json'
        result[key] = animations[name]
    return result

def weapon(name, label):
    d = raw_weapon(name)
    number = lambda key, default=0: float(d.get(key) or default)
    clip = int(number('clipSize', 1)); factor = clip if d.get('ammoCountClipRelative') == '1' else 1
    w = {'id':name,'name':label,'price':950,'model':model(d['gunModel']),
         'worldModel':model(d['worldModel']),'animations':clips(d),'clipSize':clip,
         'startAmmo':int(number('startAmmo'))*factor,'maxAmmo':int(number('maxAmmo'))*factor,
         'damage':number('damage'),'minDamage':number('minDamage'),'range':number('maxDamageRange',1000),
         'pellets':int(number('shotCount',1)),'headMultiplier':number('locHead',1),'automatic':d.get('fireType','').lower() in ['full auto','fullauto'],'fireType':d.get('fireType'),
         'hideTags':d.get('hideTags','').split(),'sounds':{k:v for k,v in d.items() if 'Sound' in k and v and k!='notetrackSoundMap'},
         'notetrackSounds':dict(re.findall(r'(\S+)\s+(\S+)',d.get('notetrackSoundMap',''))),
         'adsInTime':number('adsTransInTime',.2),'adsOutTime':number('adsTransOutTime',.2),'adsFov':number('adsZoomFov1',65)}
    for key, default in [('fireTime',.3),('reloadTime',2),('reloadEmptyTime',2),('raiseTime',.4),('dropTime',.3),('sprintInTime',.3),('sprintLoopTime',.7),('sprintOutTime',.3)]: w[key]=number(key,default)
    w['sprintOffset']=[number('sprintOfsR'),number('sprintOfsU'),-number('sprintOfsF')]
    w['sprintRotation']=[math.radians(number(k)) for k in ['sprintRotP','sprintRotY','sprintRotR']]
    for key in ['explosionRadius','explosionInnerDamage','explosionOuterDamage','projectileSpeed','reloadStartTime','reloadEndTime','reloadStartAdd','reloadAmmoAdd']:w[key]=number(key)
    w['segmentedReload']=d.get('segmentedReload')=='1'
    return w

for name, label in [('microwavegun_zm','Wave Gun'),('microwavegundw_zm','Zap Guns')]:
    w=weapon(name,label); u=weapon(name.replace('_zm','_upgraded_zm'),label)
    w['upgrade']={k:v for k,v in u.items() if k not in ['id','name','price']}
    weapons[name]=w
weapons['minigun_zm']=weapon('minigun_zm','Death Machine')
weapons['minigun_zm']['automatic']=True
weapons['microwavegundw_zm']['leftModel']=model(raw_weapon('microwavegunlh_zm')['gunModel'])
weapons['microwavegundw_zm']['leftAnimations']=clips(raw_weapon('microwavegunlh_zm'))
names={'cz75':'CZ75','cz75dw':'CZ75 Dual Wield','g11_lps':'G11','famas':'FAMAS','spectre':'Spectre','hs10':'HS10','aug_acog':'AUG','fnfal':'FN FAL','dragunov':'Dragunov','l96a1':'L96A1','m72_law':'M72 LAW','china_lake':'China Lake','knife_ballistic':'Ballistic Knife'}
for base,label in names.items():
    name=base+'_zm';w=weapon(name,label)
    upgraded='aug_acog_mk_upgraded_zm' if base=='aug_acog' else base+'_upgraded_zm'
    u=weapon(upgraded,label);w['upgrade']={k:v for k,v in u.items() if k not in ['id','name','price']};weapons[name]=w
for name,left in [('cz75dw_zm','cz75lh_zm'),('microwavegundw_zm','microwavegunlh_zm')]:
    d=raw_weapon(left);weapons[name]['leftModel']=model(d['gunModel']);weapons[name]['leftAnimations']=clips(d)
    weapons[name]['dualWield']=True
    weapons[name]['clipSize']*=2
    weapons[name]['upgrade']['clipSize']*=2
    u=raw_weapon(left.replace('_zm','_upgraded_zm'))
    weapons[name]['upgrade']['leftModel']=model(u['gunModel'])
    weapons[name]['upgrade']['leftAnimations']=clips(u)
source_script=(ROOT/'export_moon/zombie_moon_patch/maps/zombie_moon.gsc').read_text()
box_pool=re.findall(r'^\s*include_weapon\(\s*"([^"]+)"\s*(?:,\s*true\s*)?\);',source_script,re.M)
box_pool=['microwavegun_zm' if n=='microwavegundw_zm' else n for n in box_pool]
drinks=dict(kino['perkDrinks'])
for perk,suffix in [('specialty_longersprint','marathon'),('specialty_deadshot','deadshot'),('specialty_flakjacket','nuke'),('specialty_additionalprimaryweapon','additionalprimaryweapon')]:
    name='zombie_perk_bottle_'+suffix; d=raw_weapon(name)
    drinks[perk]={'id':name,'model':model(d['gunModel']),'animations':clips(d),'raiseTime':float(d['firstRaiseTime']),'dropTime':float(d['dropTime']),'adsInTime':.2,'adsOutTime':.2,'sounds':{},'notetrackSounds':{}}
equipment={name:weapon(name,label) for name,label in [('zombie_black_hole_bomb','Gersh Device'),('zombie_quantum_bomb','QED')]}
props={name:model(name) for name in ['p_zom_moon_black_egg','p_zom_moon_cassimir_plate','zombie_magic_box_wire','p_zom_moon_vril_complete','p_zom_moon_py_collector','p_zom_moon_py_collector_fill','zombie_vending_three_gun','viewmodel_zom_pressure_suit_arms','c_zom_moon_frozen_girl']}
combat = {'map':'zombie_moon','weapons':weapons,'rules':kino['rules'],'melee':kino['melee'],
    'characters':kino['characters'],'animations':animations,'powerups':kino['powerups'],
    'perkDrinks':drinks,'boxTeddy':kino['boxTeddy'],'equipment':equipment,'props':props,'boxPool':box_pool,
    'actors':{'models':actor_models,'technicians':bodies,'heads':heads,'military':'c_zom_moon_militarypolice_body_bloat'},
    'sources':{'actors':'export_moon/zombie_moon/character','commonWeapons':'export/web/assets/game-data.json','animations':'export_moon/rigs/zombie_moon/xanim'}}
(OUT/'combat-data.json').write_text(json.dumps(combat,separators=(',',':')))
print(f'Moon combat: {len(weapons)} weapons, {len(actor_models)} native actor parts, {len(animations)} animations')

"""Decode Moon music, ambience, machine speech and weapon cues from local archives."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
import zlib
from extract_resident_audio import records, container

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'export/web/assets/moon/audio';OUT.mkdir(parents=True,exist_ok=True)
TEMP=ROOT/'artifacts/moon/audio-sources';TEMP.mkdir(parents=True,exist_ok=True)
manifest_path=OUT/'manifest.json'
manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
jobs={}
for relative in ['zone/Common/zombie_moon.ff','zone/Common/common_zombie.ff']:
    data=zlib.decompress((ROOT/relative).read_bytes()[12:])
    for offset,name,h,seek,payload in records(data):
        if not name.startswith(('sound/evt/zombie_moon/','sound/wpn/','sound/fly/')):continue
        if any(x in name for x in ['/npc/','/dist/']):continue
        key='moon/'+name.removeprefix('sound/').removesuffix('.wav');ext,raw=container(h,seek,payload)
        jobs[key]=(raw,ext,relative+':'+name)
for p in (ROOT/'main').glob('*.iwd'):
    if p.name not in ['iw_37.iwd','localized_English_iw09.iwd']:continue
    with zipfile.ZipFile(p) as z:
        for name in z.namelist():
            if not name.endswith('.wav'):continue
            if not (name.startswith(('sound/evt/zombie_moon/','sound/mus/zombie/moon/','sound/mus/zombie/perksacola/')) or '/zombie_moon/mcomp/' in name and not name.endswith('_f.wav')):continue
            key='moon/'+name.removeprefix('english/').removeprefix('sound/').removesuffix('.wav')
            jobs[key]=(z.read(name),'.wav',p.relative_to(ROOT).as_posix()+':'+name)
def decode(item):
    key,(raw,ext,source)=item;digest=hashlib.sha256(raw).hexdigest();target=OUT/(digest[:20]+'.ogg')
    if not target.exists():
        packed=TEMP/(digest[:20]+ext);packed.write_bytes(raw)
        r=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(packed),'-c:a','libvorbis','-q:a','4',str(target)],capture_output=True,text=True)
        if r.returncode:raise RuntimeError(key+': '+r.stderr)
    return key,{'url':'moon/audio/'+target.name,'source':source,'sourceSha256':digest}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for key,entry in pool.map(decode,jobs.items()):manifest[key]=entry
for perk,suffix in [('specialty_deadshot','deadshot'),('specialty_flakjacket','phd'),('specialty_longersprint','stamin'),('specialty_additionalprimaryweapon','mulekick')]:
    manifest[perk]=manifest['moon/mus/zombie/perksacola/mus_'+suffix+'_sting']
manifest_path.write_text(json.dumps(manifest,indent=2))
print('Moon audio:',len(manifest),'native cues')

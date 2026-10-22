"""Record local source identities and the current browser asset inventory."""
import hashlib, json, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'export/web/assets'
sources=[]
for name in ['Common/common','Common/common_zombie','Common/zombie_theater','English/en_common_zombie','English/en_zombie_theater','Common/common_zombie_patch','Common/zombie_theater_patch']:
    p=ROOT/'zone'/(name+'.ff')
    with p.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
    sources.append({'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest})
doc=json.loads((OUT/'kino.gltf').read_text())
manifest={'format':'kino-reconstruction-provenance-v1','sources':sources,
    'world':{'nodes':len(doc['nodes']),'meshes':len(doc['meshes']),'materials':len(doc['materials']),'textures':len(doc['textures']),'bufferBytes':(OUT/'kino.bin').stat().st_size},
    'gameAssets':json.loads((OUT/'asset-report.json').read_text()),
    'navigation':json.loads((OUT/'navigation.json').read_text()),
    'audioManifest':'audio/manifest.json',
    'notes':'RECONSTRUCTION.md documents source-based behavior and remaining approximations.'}
(OUT/'provenance.json').write_text(json.dumps(manifest,indent=2))
print('Recorded',len(sources),'source fastfile hashes')

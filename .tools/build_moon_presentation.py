"""Retain native sky and Earth textures used by the browser sky shader."""
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'export/web/assets/moon/textures';OUT.mkdir(parents=True,exist_ok=True)
for name in ['skybox_zom_moon_ft','moon_vista_earth_c','moon_vista_earth_destroyed']:
    Image.open(ROOT/'export_moon/zombie_moon/images'/(name+'.dds')).convert('RGBA').save(OUT/(name+'.png'))
print('Moon sky and Earth textures converted')

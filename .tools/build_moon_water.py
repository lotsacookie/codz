"""Recover Area 51's native water normal map and shader constants."""
import hashlib
import json
import math
import struct
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'export/web/assets/moon'
material_path = ROOT / 'export_moon/zombie_moon/materials/wc/a51_water.json'
material = json.loads(material_path.read_text())
constants = {entry['name']: entry['literal'] for entry in material['constants']}
image_name = next(t['image'] for t in material['textures'] if t['name'] == 'normalMap00')
assert all(t['image'] == image_name for t in material['textures'])
entry_name = f'images/{image_name}.iwi'
for archive_path in sorted((ROOT / 'main').glob('*.iwd')):
    with zipfile.ZipFile(archive_path) as archive:
        if entry_name in archive.namelist():
            raw = archive.read(entry_name)
            break
else:
    raise FileNotFoundError(f'{entry_name} was not found in main/*.iwd')

# OAT's Image/IwiTypes.h and IwiLoader.cpp: IWI v13 has a 48-byte header
# and stores its DXT5 mips smallest first. The full-resolution mip is last.
assert raw[:5] == b'IWi\x0d\x0d', 'Expected IWI v13 DXT5'
width, height, depth = struct.unpack_from('<3H', raw, 6)
assert depth == 1 and not raw[5] & 0x0c, 'Expected a 2D normal map'
full_size, next_size = struct.unpack_from('<2I', raw, 16)
level_bytes = ((width + 3) // 4) * ((height + 3) // 4) * 16
assert full_size == len(raw) and full_size - next_size == level_bytes
waves = Image.frombytes('RGBA', (width, height), raw[next_size:full_size], 'bcn', (3, 'DXT5'))

# DXT5 normal X is stored in alpha, Y in green; reconstruct the positive Z.
pixels = waves.tobytes()
normal = Image.new('RGB', waves.size)
normal.putdata([(a, g, round((math.sqrt(max(0, 1-(a/127.5-1)**2-(g/127.5-1)**2))+1)*127.5))
                for g, a in zip(pixels[1::4], pixels[3::4])])
(OUT / 'textures').mkdir(parents=True, exist_ok=True)
normal_uri = f'textures/{image_name}.png'
normal.save(OUT / normal_uri)
(OUT / 'water.json').write_text(json.dumps({
    'material': 'wc/a51_water', 'normalMap': normal_uri, 'constants': constants,
    'source': {'archive': archive_path.relative_to(ROOT).as_posix(), 'entry': entry_name,
               'sha256': hashlib.sha256(raw).hexdigest(),
               'material': material_path.relative_to(ROOT).as_posix(),
               'materialSha256': hashlib.sha256(material_path.read_bytes()).hexdigest()},
}, indent=2) + '\n')
print(f'Moon water: {image_name}, {width}x{height}, native Area 51 constants')

"""Build phone-sized texture variants before Safari ever decodes the images."""
import json
from pathlib import Path
from urllib.parse import unquote
from PIL import Image

root = Path(__file__).resolve().parents[1]
web = root / 'export' / 'web' / 'assets'
source = web / 'textures'
destination = web / 'textures-mobile'
count = 0
before = after = 0
for original in source.rglob('*'):
    if not original.is_file():
        continue
    relative = original.relative_to(source)
    output = destination / relative
    output.parent.mkdir(parents=True, exist_ok=True)
    limit = 512 if 'viewarm' in original.name or 'viewhands' in original.name else 256
    with Image.open(original) as image:
        before += image.width * image.height * 4
        if not output.exists() or output.stat().st_mtime < original.stat().st_mtime:
            image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
            if original.suffix.lower() == '.webp':
                image.save(output, quality=85, method=4)
            else:
                image.save(output, optimize=True)
        with Image.open(output) as small:
            assert max(small.size) <= limit, output
            after += small.width * small.height * 4
        count += 1

gltf = json.loads((web / 'kino.gltf').read_text())
world_before = world_after = 0
for entry in gltf['images']:
    relative = Path(unquote(entry['uri'])).relative_to('textures')
    with Image.open(source / relative) as image:
        world_before += image.width * image.height * 4
    with Image.open(destination / relative) as image:
        world_after += image.width * image.height * 4
report = dict(textures=count, sourceRGBABytes=before, mobileRGBABytes=after,
              worldSourceRGBABytes=world_before, worldMobileRGBABytes=world_after)
out = root / 'artifacts' / 'cloudflare'
out.mkdir(parents=True, exist_ok=True)
(out / 'mobile-textures.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))

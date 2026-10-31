import base64, json, struct, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'export' / 'web' / 'assets'
SOURCE = ROOT / 'reference' / 'common_zombie' / 'models'
OUT = ROOT / 'models'

GIBS = {
    'fx_char_gib_chunk_bone02': (0.80, 0.76, 0.62),
    'fx_char_gib_chunk_bone03': (0.78, 0.74, 0.60),
    'fx_char_gib_chunk_fat': (0.74, 0.58, 0.40),
    'fx_char_gib_chunk_flesh01': (0.46, 0.09, 0.07),
    'fx_char_gib_chunk_flesh02': (0.40, 0.08, 0.06),
    'fx_char_gib_chunk_flesh03': (0.52, 0.12, 0.09),
    'fx_char_gib_chunk_meat01': (0.36, 0.06, 0.05),
    'fx_char_gib_chunk_meat02': (0.42, 0.08, 0.06),
}
BARS = ['p_zom_win_bars_01_vert01_bend_180', 'p_zom_win_bars_01_vert04_bend_180']
MATERIALS = {
    'mc/jun_art_concrete_base02_dark': ((0.34, 0.33, 0.31), 0.95, 0.0),
    'mc/jun_art_concrete_edges01': ((0.40, 0.39, 0.36), 0.95, 0.0),
    'mc/mtl_p_zom_window_cell_bars': ((0.20, 0.19, 0.18), 0.6, 0.7),
}


def name_of(handle):
    info = handle.get('info') if isinstance(handle, dict) else None
    if not info:
        return None
    return base64.b64decode(info['name']['base64']).decode()


def half(value):
    return struct.unpack('<e', struct.pack('<H', value))[0]


def vertex(entry):
    x, y, z = entry['xyz']['v']
    nb = base64.b64decode(entry['normal']['array']['base64'])
    nx, ny, nz = [(b - 127.0) / 127.0 for b in nb[:3]]
    length = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
    packed = entry['texCoord']['packed']
    u, v = half(packed & 0xFFFF), half((packed >> 16) & 0xFFFF)
    return (x, z, -y), (nx / length, nz / length, -ny / length), (u, v)


def pad(blob, fill=b'\x00'):
    return blob + fill * (-len(blob) % 4)


def build(surfaces, materials):
    chunks, views, accessors, primitives = [], [], [], []
    offset = 0

    def push(blob, target):
        nonlocal offset
        blob = pad(blob)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(blob), 'target': target})
        chunks.append(blob)
        offset += len(blob)
        return len(views) - 1

    for surface, material in surfaces:
        verts = [vertex(v) for v in surface['verts0']]
        tris = [t['i'] for t in surface['triIndices']]
        flat = [i for tri in tris for i in tri]
        if not verts or not flat or max(flat) >= len(verts):
            continue
        positions = [p for p, _, _ in verts]
        lows = [min(p[k] for p in positions) for k in range(3)]
        highs = [max(p[k] for p in positions) for k in range(3)]
        attrs = {}
        for key, data, count in (('POSITION', positions, 3), ('NORMAL', [n for _, n, _ in verts], 3), ('TEXCOORD_0', [t for _, _, t in verts], 2)):
            view = push(b''.join(struct.pack('<%df' % count, *item) for item in data), 34962)
            accessor = {'bufferView': view, 'componentType': 5126, 'count': len(verts), 'type': 'VEC%d' % count}
            if key == 'POSITION':
                accessor['min'], accessor['max'] = lows, highs
            accessors.append(accessor)
            attrs[key] = len(accessors) - 1
        view = push(struct.pack('<%dI' % len(flat), *flat), 34963)
        accessors.append({'bufferView': view, 'componentType': 5125, 'count': len(flat), 'type': 'SCALAR'})
        primitives.append({'attributes': attrs, 'indices': len(accessors) - 1, 'material': material, 'mode': 4})
    return chunks, views, accessors, primitives


def write(name, surfaces, materials):
    chunks, views, accessors, primitives = build(surfaces, materials)
    if not primitives:
        print('skipped', name)
        return False
    binary = b''.join(chunks)
    document = {
        'asset': {'version': '2.0', 'generator': 'export-fx-models.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': name}],
        'meshes': [{'name': name, 'primitives': primitives}],
        'materials': materials,
        'buffers': [{'byteLength': len(binary)}],
        'bufferViews': views,
        'accessors': accessors,
    }
    text = pad(json.dumps(document, separators=(',', ':')).encode(), b' ')
    total = 12 + 8 + len(text) + 8 + len(binary)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / (name + '.glb')).write_bytes(
        struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(text), b'JSON') + text + struct.pack('<I4s', len(binary), b'BIN\x00') + binary)
    print('wrote', name, len(primitives), 'primitives')
    return True


def pbr(color, rough, metal):
    return {'pbrMetallicRoughness': {'baseColorFactor': [*color, 1.0], 'roughnessFactor': rough, 'metallicFactor': metal}, 'doubleSided': True}


def main():
    for name, color in GIBS.items():
        asset = json.loads((SOURCE / (name + '.json')).read_text())['asset']
        write(name, [(asset['surfs'][0], 0)], [pbr(color, 0.55, 0.0)])
    for name in BARS:
        asset = json.loads((SOURCE / (name + '.json')).read_text())['asset']
        handles = [name_of(h) for h in asset['materialHandles']]
        defaults = list(MATERIALS)
        handles = [h or (defaults[i] if i < 3 else None) for i, h in enumerate(handles)]
        pairs, table = [], []
        for surface, material in zip(asset['surfs'], handles):
            if material not in MATERIALS:
                continue
            if material not in table:
                table.append(material)
            pairs.append((surface, table.index(material)))
        write(name, pairs, [pbr(*MATERIALS[m]) for m in table])


if __name__ == '__main__':
    sys.exit(main())

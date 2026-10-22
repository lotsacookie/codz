"""Encode selected reference-pack sounds into export/web/assets/audio and merge them into manifest.json.

Source files come from export/web/assets/reference/sounds (see .github/workflows/extract-reference.yml).
Run after extract_audio.py (which rewrites manifest.json from scratch); this script only adds keys.
Usage: python .tools/extract_reference_audio.py
"""
import hashlib, json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT / 'export/web/assets'
SOURCE = WEB / 'reference/sounds'
OUT = WEB / 'audio'

# key -> path under reference/sounds. Keys are consumed by audio.js (heartbeat, tinnitus, scope breathing, death card).
CUES = {
    'heartbeat': 'sound/chr/heartbeat/heartbeat_loop_l.wav',
    'tinnitus': 'sound/chr/tinitus/chr_tinitus_loop_l.wav',
    'scope_breath_in': 'sound/chr/breath/sniper/vox_sniper_breathin.wav',
    'scope_breath_out': 'sound/chr/breath/sniper/vox_sniper_breathout.wav',
    'scope_breath_gasp': 'sound/chr/breath/sniper/vox_sniper_breathgasp.wav',
    'death_card': 'sound/evt/zombie_global/death_card/death_card_00.wav',
}


def main():
    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for key, relative in CUES.items():
        source = SOURCE / relative
        if not source.exists():
            raise SystemExit('Missing reference sound: ' + str(source))
        target = OUT / (key + '.ogg')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-c:a', 'libvorbis', '-q:a', '4', str(target)], check=True)
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(target)]))['streams'][0]
        manifest[key] = {
            'url': 'audio/' + target.name,
            'source': 'export/web/assets/reference/sounds/' + relative,
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'duration': float(probe['duration']),
            'sampleRate': int(probe['sample_rate']),
            'channels': probe['channels'],
        }
        print(key, round(manifest[key]['duration'], 2), 'seconds', target.stat().st_size, 'bytes')
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print('Manifest now has', len(manifest), 'cues')


if __name__ == '__main__':
    sys.exit(main())

"""Recover validated inline T5 LoadedSound records without a full zone walker.

Layout: OAT T5_Assets.h LoadedSound/snd_asset (60 bytes), inline name,
seek_table, then sound.data. Zone alignment applies to virtual block cursors,
not to the serialized stream. WMA payloads are xWMA packets; reconstruct RIFF
fmt/dpds/data for FFmpeg. Keep offsets and hashes so every cue is auditable.
"""
import hashlib, json, pathlib, re, struct, subprocess, zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT/'export/web/assets/audio'
TEMP = ROOT/'artifacts/resident-audio'
EVENT_PREFIXES = tuple('sound/evt/zombie_global/'+p+'/' for p in ['powerup','nuke','perksacola/bottle','box'])

def records(data):
    for m in re.finditer(rb'sound[\\/][a-zA-Z0-9_./\\ -]+\.wav\x00', data, re.I):
        if m.start() < 60: continue
        h = struct.unpack_from('<15I', data, m.start()-60)
        if h[0] != 0xffffffff or h[1] != 1 or h[3] not in (22050, 24000, 32000, 44100, 48000) or h[4] not in (1, 2): continue
        if h[14] != 0xffffffff or h[8] not in (0, 6, 7) or not 0 < h[13] < 10_000_000: continue
        if h[11] > 4096 or (h[11] and h[12] != 0xffffffff): continue
        end = m.end()+4*h[11]+h[13]
        if end > len(data): continue
        seek = data[m.end():m.end()+4*h[11]]
        if h[8] == 7:
            if not h[11] or h[13] % h[11]: continue
            sizes = struct.unpack('<'+'I'*h[11], seek)
            if list(sizes) != sorted(sizes) or sizes[-1] != h[2]*h[4]*2: continue
        yield m.start()-60, m.group()[:-1].decode().replace('\\','/'), h, seek, data[m.end()+4*h[11]:end]

def chunk(name, data):
    return name+struct.pack('<I',len(data))+data+(b'\0' if len(data)%2 else b'')

def container(h, seek, payload):
    if h[8] == 7:
        # T5 xWMA: 96 kbps nominal header; FFmpeg applies Microsoft's
        # mono 44.1kHz correction. Packet size comes from the seek table.
        fmt = struct.pack('<HHIIHHH',0x161,h[4],h[3],12000,h[13]//h[11],16,0)
        riff = b'XWMA'+chunk(b'fmt ',fmt)+chunk(b'dpds',seek)+chunk(b'data',payload)
        return '.xwma', b'RIFF'+struct.pack('<I',len(riff))+riff
    if h[8] == 0:
        fmt = struct.pack('<HHIIHH',1,h[4],h[3],h[3]*h[4]*2,h[4]*2,16)
        riff = b'WAVE'+chunk(b'fmt ',fmt)+chunk(b'data',payload)
        return '.wav', b'RIFF'+struct.pack('<I',len(riff))+riff
    header = struct.pack('<14I',*(list(h[1:12])+[0,h[13],0]))+seek
    return '.boa', header+bytes(h[5]-len(header))+payload

def main():
    TEMP.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
    inventory = {}
    for zone in ['common_zombie','zombie_theater']:
        source = ROOT/'zone/Common'/(zone+'.ff')
        raw = source.read_bytes()
        if raw[:8] != b'IWffu100': raise ValueError('Unsupported fastfile '+str(source))
        data = zlib.decompress(raw[12:])
        for offset,name,h,seek,payload in records(data):
            if name.startswith(('sound/wpn/','sound/fly/gear/','sound/fly/melee/',*EVENT_PREFIXES)):
                inventory[name] = (source,offset,h,seek,payload)
    manifest_path = OUT/'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    report = []
    for name,(source,offset,h,seek,payload) in sorted(inventory.items()):
        # All weapon foley plus first-person fire, knife and Bowie variants.
        if '/npc/' in name or '/dist/' in name: continue
        if not name.startswith(EVENT_PREFIXES) and not any(s in name for s in ['/foley/','/reload/','/plr/shot/','/plr/act/','/melee/','/bowie/','/gear/']): continue
        key = 'resident/'+name.removeprefix('sound/').removesuffix('.wav')
        digest = hashlib.sha256(payload).hexdigest()
        target = OUT/('resident-'+digest[:20]+'.ogg')
        if not target.exists() or manifest.get(key,{}).get('decoderVersion') != 2:
            ext,raw = container(h,seek,payload)
            packed = TEMP/(digest[:20]+ext); packed.write_bytes(raw)
            run = subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(packed),
                '-af',f'atrim=end_sample={h[2]},asetpts=N/SR/TB','-c:a','libvorbis','-q:a','4',str(target)],capture_output=True,text=True)
            if run.returncode or run.stderr.strip():
                raise RuntimeError('Decode failed for '+name+': '+run.stderr)
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(target)]))['streams'][0]
        manifest[key] = {'url':'audio/'+target.name,'source':source.relative_to(ROOT).as_posix()+':'+name,
            'zoneOffset':offset,'sourceSha256':digest,'duration':float(probe['duration']),'nativeDuration':h[2]/h[3],
            'sampleRate':h[3],'channels':h[4],'nativeFormat':h[8],'decoderVersion':2}
        report.append({'key':key,**manifest[key]})
    manifest_path.write_text(json.dumps(manifest,indent=2))
    (TEMP/'report.json').write_text(json.dumps(report,indent=2))
    print('Decoded',len(report),'resident weapon and interaction cues')

if __name__ == '__main__': main()

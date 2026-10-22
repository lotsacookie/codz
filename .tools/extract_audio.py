"""Decode locally owned T5 IWD sound files with FFmpeg's Black Ops Audio demuxer."""
import hashlib, json, pathlib, subprocess, sys, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'export/web/assets/audio';OUT.mkdir(parents=True,exist_ok=True)
TEMP=ROOT/'artifacts/native-audio';TEMP.mkdir(parents=True,exist_ok=True)
requests={
 'fire_sale':'english/sound/vox/scripted/zmb/announcer/firesale_short.wav',
 'fire_sale_music':'sound/mus/zombie/firesale/mus_chap205_19.00_l.wav',
 'ambience':'sound/mus/zombie_theatre/mus_theatre_underscore_l.wav',
 'round':'sound/mus/zombie/zombie_global/mus_zombie_round_start.wav',
 'round_end':'sound/mus/zombie/zombie_global/mus_zombie_round_over.wav',
 'dog_round':'sound/mus/zombie/zombie_global/mus_zombie_dog_start.wav',
 'dog_end':'sound/mus/zombie/zombie_global/mus_doground_end.wav',
 'specialty_quickrevive':'sound/mus/zombie/perksacola/mus_revive_sting.wav',
 'specialty_fastreload':'sound/mus/zombie/perksacola/mus_speed_sting.wav',
 'specialty_rof':'sound/mus/zombie/perksacola/mus_doubletap_sting.wav',
 'specialty_armorvest':'sound/mus/zombie/perksacola/mus_jugganog_sting.wav',
 'packapunch':'sound/mus/zombie/perksacola/mus_packapunch_sting.wav',
 '115':'sound/mus/zombie/theater/115.wav',
 'board':'sound/phy/wood/wood_wood/wood_wood_02.wav',
 'dog':'sound/aml/dog/growl/growl_00.wav',
}
for key,name in {'full_ammo':'maxammo','insta_kill':'instakill','double_points':'doublepoints','nuke':'nuke','carpenter':'carpenter','dog_announce':'dog_start_vox_b'}.items():
 requests[key]='english/sound/vox/scripted/zmb/ann/ann_'+name+'.wav'
remaining=set(requests);manifest={}
for archive in sorted((ROOT/'main').glob('*.iwd')):
 with zipfile.ZipFile(archive) as z:
  names=set(z.namelist())
  for key in sorted(remaining.copy()):
   name=requests[key]
   if name not in names:continue
   raw=z.read(name);source=TEMP/(key+'.wav');source.write_bytes(raw)
   target=OUT/(key+'.ogg')
   subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-c:a','libvorbis','-q:a','4',str(target)],check=True)
   probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(target)]))['streams'][0]
   manifest[key]={'url':'audio/'+target.name,'source':str(archive.relative_to(ROOT)).replace('\\','/')+':'+name,'sourceSha256':hashlib.sha256(raw).hexdigest(),'duration':float(probe['duration']),'sampleRate':int(probe['sample_rate']),'channels':probe['channels']}
   remaining.remove(key)
   print(key,round(float(probe['duration']),2),'seconds')
if remaining:raise RuntimeError('Missing native cues: '+str(remaining))
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('Decoded',len(manifest),'native cues')
subprocess.run([sys.executable,str(ROOT/'.tools/extract_resident_audio.py')],check=True)
subprocess.run([sys.executable,str(ROOT/'.tools/extract_reference_audio.py')],check=True)

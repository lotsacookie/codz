// Native T5 cues decoded from IWD streams and resident LoadedSound records.
const shotFolders={m1911:'pistol/m1911',m14:'assault/m14',rottweil72:'shotgun/rottweil72',ithaca:'shotgun/ithaca',
  mp40:'smg/mp40',mp5k:'smg/mp5',mpl:'smg/mpl',pm63:'smg/pm63',ak74u:'smg/ak74',m16:'assault/m16',
  galil:'assault/galil',commando:'assault/commando',hk21:'lmg/hk21',rpk:'lmg/rpk',python:'pistol/357',spas:'shotgun/spas',
  cz75:'pistol/cz75',cz75dw:'pistol/cz75',g11_lps:'smg/g11',famas:'assault/famas',spectre:'smg/spectre',hs10:'shotgun/hs10',aug_acog:'assault/aug',fnfal:'assault/fnfal',dragunov:'sniper/dragunov',l96a1:'sniper/l96a1',china_lake:'gren_launcher/china_lake',crossbow_explosive:'crossbow',knife_ballistic:'melee/ballistic_knife'};
const SPATIAL={near:140,rolloff:1.6,far:6000};
export class GameAudio {
  constructor(){this.camera=null;this.spatial=new Set();this.watching=false;this._enabled=true;this.ctx=null;this.manifest={};this.buffers=new Map();this.bufferSizes=new Map();this.bufferBytes=0;this.maxBufferBytes=Infinity;this.preload=true;this.played=[];this.music=null;this.musicToken=0;this.variants=new Map();}
  async load(){const r=await fetch('audio/manifest.json');if(!r.ok)throw new Error('Audio manifest HTTP '+r.status);this.manifest=await r.json();}
  get enabled(){return this._enabled;}
  set enabled(v){this._enabled=v;if(this.master)this.master.gain.value=v?.42:0;}
  start(){if(!this.ctx){const Context=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Context){this.enabled=false;return;}this.ctx=new Context();this.master=this.ctx.createGain();this.master.gain.value=this.enabled?.42:0;this.master.connect(this.ctx.destination);
    if(this.preload)for(const key of Object.keys(this.manifest))if(key.startsWith('resident/evt/zombie_global/')||['buy','nuke','full_ammo','insta_kill','double_points','carpenter','fire_sale','fire_sale_music'].includes(key)||key.startsWith('specialty_'))this.buffer(key).catch(console.error);
  }this.ctx.resume();if(!this.music)this.playMusic('ambience');}
  select(prefix){
    if(!this.variants.has(prefix))this.variants.set(prefix,Object.keys(this.manifest).filter(k=>k.startsWith(prefix)));
    const keys=this.variants.get(prefix);return keys[Math.floor(Math.random()*keys.length)];
  }
  warmWeapon(def,notifies=[]){
    if(!this.ctx)return;
    const prefix='resident/wpn/'+shotFolders[def.id.replace('_zm','')]+'/plr/shot/';
    const needed=new Set(notifies.map(name=>this.notifyKey(name,def)).filter(Boolean));
    for(const key of Object.keys(this.manifest))if(key.startsWith(prefix)||key.includes('/melee/knife/')||key.includes('/bowie/')||needed.has(key))this.buffer(key).catch(()=>{});
  }
  weapon(kind,def){
    const prefix=shotFolders[def.id.replace('_zm','')];
    let cue;
    if(kind==='shot'&&prefix)cue=this.select('resident/wpn/'+prefix+'/plr/shot/shot_');
    if(kind==='shot'&&def.attachmentActive&&def.projectileSpeed>0)cue=this.select('resident/wpn/gren_launcher/attachment/plr/shot/');
    if(kind==='shot'&&def.id==='ray_gun_zm')cue='resident/wpn/energy/raygun/plr/shot/ray_shot_f';
    if(kind==='shot'&&def.id==='thundergun_zm')cue='resident/wpn/energy/thundergun/plr/shot/wpn_thundergun_fire_plr';
    if(kind==='empty'&&prefix)cue=this.select('resident/wpn/'+prefix+'/plr/act/');
    this.play(cue??kind,kind==='shot'?.75:1);
  }
  knife(kind,bowie=false){
    const prefix=bowie?(kind==='swing'?'bowie/bowie_swing/':'bowie/bowie_stab/'):
      'melee/knife/'+({swing:'knife_whoosh/',hit:'knife_stab/',wall:'hit_object/',pull:'knife_pull/'}[kind]);
    const key=this.select('resident/wpn/'+(kind==='wall'?'melee/knife/hit_object/':prefix));
    if(key)this.play(key,.9);
  }
  notifyKey(name,def){
    if(name.startsWith('rmbnt#'))return;
    name=def.notetrackSounds?.[name]??name.replace(/^sndnt#/, '');
    const bottle={evt_perk_bottle_open:'open/openmn_00',bottle_open:'open/openmn_00',evt_perk_swallow:'swallow/swallowmn_00',swallow:'swallow/swallowmn_00',evt_bottle_break:'break/breakmn_00',bottle_break:'break/breakmn_00',evt_belch:'belch/belchmn_00',belch:'belch/belchmn_00'}[name];
    if(bottle)return 'resident/evt/zombie_global/perksacola/bottle/'+bottle;
    // Melee swing/impact cues are emitted by the strike timeline once.
    if(['bowie_swing','bowie_stab'].includes(name))return;
    const base=name.replace(/_plr$/, '');
    return Object.keys(this.manifest).find(k=>k.endsWith('/'+name)||k.endsWith('/'+base)||k.endsWith('/'+name+'_00')||k.endsWith('/'+base+'_00'));
  }
  notify(name,def){const key=this.notifyKey(name,def);if(key)this.play(key,.65);}
  event(path,volume=1,position=null){this.play('resident/evt/zombie_global/'+path,volume,position);}
  fireSale(on){
    if(this.saleOn===on)return;this.saleOn=on;const token=this.saleToken=(this.saleToken??0)+1;
    this.saleMusic?.stop();this.saleMusic=null;
    if(on&&this.ctx)this.native('fire_sale_music',.35,true).then(source=>{if(token!==this.saleToken)source.stop();else this.saleMusic=source;}).catch(console.error);
  }
  pause(){this.ctx?.suspend();}
  dispose(){this.musicToken++;try{this.music?.stop();}catch{}this.music=null;try{this.saleMusic?.stop();}catch{}this.saleMusic=null;this.buffers.clear();this.bufferSizes.clear();this.bufferBytes=0;this.variants.clear();const ctx=this.ctx;this.ctx=null;this.master=null;ctx?.close?.().catch(()=>{});}
  async buffer(key){
    if(this.buffers.has(key)){const cached=this.buffers.get(key);this.buffers.delete(key);this.buffers.set(key,cached);return cached;}
    const pending=fetch(this.manifest[key].url).then(r=>{if(!r.ok)throw new Error('Audio '+key+' HTTP '+r.status);return r.arrayBuffer();}).then(b=>this.ctx.decodeAudioData(b)).then(buffer=>{
      const bytes=buffer.length*buffer.numberOfChannels*4;this.bufferSizes.set(key,bytes);this.bufferBytes+=bytes;
      for(const oldest of this.buffers.keys()){
        if(this.bufferBytes<=this.maxBufferBytes)break;
        const size=this.bufferSizes.get(oldest);if(size==null)continue;
        this.buffers.delete(oldest);this.bufferSizes.delete(oldest);this.bufferBytes-=size;
      }
      return buffer;
    }).catch(error=>{this.buffers.delete(key);throw error;});
    this.buffers.set(key,pending);return pending;
  }
  async native(key,volume=1,loop=false,position=null){
    const b=await this.buffer(key),source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=b;source.loop=loop;gain.gain.value=volume;source.connect(gain);
    const panner=position&&this.camera?this.panner(position):null;
    if(panner){gain.connect(panner);panner.connect(this.master);this.spatial.add(source);this.syncListener();this.watchListener();}else gain.connect(this.master);
    source.onended=()=>{this.spatial.delete(source);source.disconnect();gain.disconnect();panner?.disconnect();};
    source.start();this.played.push(key);if(this.played.length>30)this.played.shift();return source;
  }
  panner(position){
    const p=this.ctx.createPanner(),[x,y,z]=Array.isArray(position)?position:[position.x,position.y,position.z];
    p.panningModel='equalpower';p.distanceModel='inverse';p.refDistance=SPATIAL.near;p.rolloffFactor=SPATIAL.rolloff;p.maxDistance=SPATIAL.far;
    if(p.positionX){p.positionX.value=x;p.positionY.value=y;p.positionZ.value=z;}else p.setPosition(x,y,z);
    return p;
  }
  syncListener(){
    const cam=this.camera,l=this.ctx?.listener;if(!cam||!l)return;
    cam.updateWorldMatrix(true,false);const m=cam.matrixWorld.elements;
    if(l.positionX){l.positionX.value=m[12];l.positionY.value=m[13];l.positionZ.value=m[14];l.forwardX.value=-m[8];l.forwardY.value=-m[9];l.forwardZ.value=-m[10];l.upX.value=m[4];l.upY.value=m[5];l.upZ.value=m[6];}
    else{l.setPosition(m[12],m[13],m[14]);l.setOrientation(-m[8],-m[9],-m[10],m[4],m[5],m[6]);}
  }
  watchListener(){
    if(this.watching)return;this.watching=true;
    const tick=()=>{if(!this.ctx||!this.spatial.size){this.watching=false;return;}this.syncListener();requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
  }
  async playMusic(key){if(!this.ctx)return;const token=++this.musicToken;this.music?.stop();this.music={stop(){}};let music;try{music=await this.native(key,key==='ambience'?.18:.65,key==='ambience');}catch(error){console.warn('Music '+key+' could not be decoded',error);return;}if(token!==this.musicToken){music.stop();return;}this.music=music;}
  play(kind,volume=1,position=null){
    if(!this.enabled||!this.ctx||this.ctx.state!=='running')return;
    if(this.manifest[kind]){this.native(kind,volume*.8,false,position).catch(console.error);return;}
    const c=this.ctx,t=c.currentTime,g=c.createGain();g.connect(this.master);g.gain.setValueAtTime(Math.max(.001,volume*.25),t);
    const duration={shot:.18,knife:.16,hit:.08,board:.18,reload:.11,growl:.75,round:1.5,buy:.35,empty:.06,explosion:.9}[kind]??.25;
    g.gain.exponentialRampToValueAtTime(.001,t+duration);
    if(['shot','knife','hit','board','reload','growl','explosion'].includes(kind)){
      const buffer=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),a=buffer.getChannelData(0);
      for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1);
      const src=c.createBufferSource(),filter=c.createBiquadFilter();src.buffer=buffer;filter.type='lowpass';filter.frequency.value=kind==='growl'?180:kind==='shot'?3500:kind==='explosion'?400:1600;src.connect(filter);filter.connect(g);src.start();src.stop(t+duration);
    }else{const o=c.createOscillator();o.type=kind==='round'?'sawtooth':'sine';o.frequency.setValueAtTime(kind==='round'?62:kind==='buy'?660:180,t);o.frequency.exponentialRampToValueAtTime(kind==='round'?38:kind==='buy'?990:60,t+duration);o.connect(g);o.start();o.stop(t+duration);}
  }
  snapshot(){return {enabled:this.enabled,nativeCues:Object.keys(this.manifest).length,decoded:this.buffers.size,decodedBytes:this.bufferBytes,played:this.played.slice(),state:this.ctx?.state??'idle'};}
}

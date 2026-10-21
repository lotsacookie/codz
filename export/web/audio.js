import {zombieCues,dogCues,preloadZombieKeys,preloadDogKeys} from './zombie-sfx.js';
import {weaponProfile,weaponFolder,foleyKey,blastCues,hasScope,GRENADE_LAUNCHER_FOLDER} from './weapon-sfx.js';
// Native T5 cues decoded from IWD streams and resident LoadedSound records.
const SPATIAL={near:140,rolloff:1.6,far:6000};
const VOICE_RANGE=1600,VOICE_LIMIT=14;
export class GameAudio {
  constructor(){this.camera=null;this.spatial=new Set();this.tracked=new Map();this.voices=new Set();this.watching=false;this._enabled=true;this.ctx=null;this.manifest={};this.buffers=new Map();this.bufferSizes=new Map();this.bufferBytes=0;this.maxBufferBytes=Infinity;this.preload=true;this.played=[];this.music=null;this.musicToken=0;this.variants=new Map();this.lastStart=new Map();this.profiles=new Map();this.wpnKeys=null;}
  async load(){const r=await fetch('audio/manifest.json');if(!r.ok)throw new Error('Audio manifest HTTP '+r.status);this.manifest=await r.json();this.profiles.clear();this.wpnKeys=null;this.zombieVoices=null;this.dogVoices=null;}
  get enabled(){return this._enabled;}
  set enabled(v){this._enabled=v;if(this.master)this.master.gain.value=v?.42:0;}
  start(){if(!this.ctx){const Context=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Context){this.enabled=false;return;}this.ctx=new Context();this.master=this.ctx.createGain();this.master.gain.value=this.enabled?.42:0;this.master.connect(this.ctx.destination);
    if(this.preload)this.runPreload(this.preloadKeys());
  }this.ctx.resume();if(!this.music)this.playMusic('ambience');}
  preloadKeys(){
    const first=['round','round_end','dog_round','buy','explosion'].filter(key=>this.manifest[key]),later=['nuke','full_ammo','insta_kill','double_points','carpenter','fire_sale','fire_sale_music','heartbeat','tinnitus','scope_breath_in','scope_breath_out','scope_breath_gasp','death_card'];
    const rest=Object.keys(this.manifest).filter(key=>!first.includes(key)&&(key.startsWith('resident/evt/zombie_global/')||later.includes(key)||key.startsWith('specialty_')));
    return [...first,...rest,...preloadZombieKeys(this.zombieCues()),...preloadDogKeys(this.dogCues())];
  }
  runPreload(keys){
    const queue=[...keys],work=async()=>{while(queue.length&&this.ctx){const key=queue.shift();try{await this.buffer(key,'low');}catch(error){console.error(error);}}};
    for(let i=0;i<3;i++)work();
  }
  staleLimit(kind){return /(\/shot\/|\/act\/|\/plr\/|swing|stab|whoosh|\/hit)/.test(kind)?250:4000;}
  select(prefix){
    if(!this.variants.has(prefix))this.variants.set(prefix,Object.keys(this.manifest).filter(k=>k.startsWith(prefix)));
    const keys=this.variants.get(prefix);return keys[Math.floor(Math.random()*keys.length)];
  }
  profile(def,folder=null){
    this.wpnKeys??=Object.keys(this.manifest).filter(k=>/^(resident|ref)\/wpn\//.test(k));
    const id=(folder??'')+'|'+def.id;
    if(!this.profiles.has(id))this.profiles.set(id,weaponProfile(def,this.wpnKeys,folder));
    return this.profiles.get(id);
  }
  launcherProfile(def){return def.attachmentActive&&def.projectileSpeed>0?this.profile(def,GRENADE_LAUNCHER_FOLDER):null;}
  pick(pool){return pool?.length?pool[Math.floor(Math.random()*pool.length)]:undefined;}
  later(ms,fn){setTimeout(()=>{if(this.ctx)fn();},ms);}
  warmWeapon(def,notifies=[]){
    if(!this.ctx)return;
    const profile=this.profile(def),needed=new Set(notifies.map(name=>this.notifyKey(name,def)).filter(Boolean));
    for(const pool of [profile.shot,profile.npcShot,profile.lfe,profile.sweet,profile.ring,profile.dry,profile.classDry,profile.classLfe,profile.shell,profile.pap])for(const key of pool)needed.add(key);
    for(const key of Object.keys(this.manifest))if(key.startsWith('resident/')&&(key.includes('/melee/knife/')||key.includes('/bowie/')))needed.add(key);
    for(const key of needed)this.buffer(key).catch(()=>{});
  }
  distanceTo(position){
    const cam=this.camera?.position;if(!position||!cam)return 0;
    const [x,y,z]=Array.isArray(position)?position:[position.x,position.y,position.z];return Math.hypot(x-cam.x,y-cam.y,z-cam.z);
  }
  weapon(kind,def,position=null,gain=1){
    const profile=this.launcherProfile(def)??this.profile(def);
    if(kind==='empty'){
      const cue=this.pick(position?profile.npcDry:profile.dry)??this.pick(profile.dry)??this.pick(profile.classDry);
      if(position&&!cue)return;
      this.play(cue??kind,gain,position);return;
    }
    if(kind!=='shot'){this.play(kind,gain,position);return;}
    const main=(position?this.pick(profile.npcShot):null)??this.pick(profile.shot)??this.pick(profile.npcShot)??this.pick(profile.dist);
    if(position&&!main)return;
    this.play(main??kind,.75*gain,position);
    // Layers from the same alias group: low-frequency thump, sweetener, tail, stereo flux.
    const layer=(pool,volume,delay=0)=>{const key=this.pick(pool);if(!key)return;if(delay)this.later(delay,()=>this.play(key,volume*gain,position));else this.play(key,volume*gain,position);};
    layer(profile.lfe.length?profile.lfe:profile.classLfe,.5);
    layer(profile.sweet,.4);
    layer(profile.ring.length?profile.ring:profile.classRing,.3,40);
    if(!position){
      layer(profile.flux.length?profile.flux:profile.classFlux,.25);
      layer(profile.shell,.3,320);
      if(def.upgraded){layer(profile.pap,.45);layer(profile.flame,.4);}
    }else if(this.distanceTo(position)>900)layer(profile.dist.length?profile.dist:profile.classDist,.6);
  }
  weaponAt(def,position,gain=1){
    if(!this.warmed?.has(def.id)){(this.warmed??=new Set()).add(def.id);this.warmWeapon(def);}
    this.weapon('shot',def,position,gain);
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
    const own=foleyKey(this.profile(def),name);if(own)return own;
    const base=name.replace(/_plr$/, '');
    return Object.keys(this.manifest).find(k=>k.endsWith('/'+name)||k.endsWith('/'+base)||k.endsWith('/'+name+'_00')||k.endsWith('/'+base+'_00'));
  }
  notify(name,def){const key=this.notifyKey(name,def);if(key)this.play(key,.65);}
  event(path,volume=1,position=null){this.play('resident/evt/zombie_global/'+path,volume,position);}
  blast(kind='grenade',gain=1){
    for(const layer of blastCues(kind,Object.keys(this.manifest)))this.play(this.pick(layer),gain*(layer[0].includes('/lfe/')?.6:.8));
    if(!this.manifest['ref/wpn/grenade/explosion/explode/explode_00'])this.play('explosion',gain);
  }
  grenadeThrow(){this.play('ref/wpn/grenade/foley/pin/pin',.6);this.later(180,()=>this.play('ref/wpn/grenade/foley/throw/gren_throw',.7));}
  grenadeBounce(){
    const now=this.ctx?.currentTime??0;if(now-(this.lastBounce??-1)<.12)return;this.lastBounce=now;
    const key=this.select('ref/wpn/grenade/bounce/frag/earth/earth_');if(key)this.play(key,.5);
  }
  zoom(def){if(!hasScope(def))return;const key=this.select('ref/wpn/scope/zoom/zoom_');if(key)this.play(key,.5);}
  fireSale(on){
    if(this.saleOn===on)return;this.saleOn=on;const token=this.saleToken=(this.saleToken??0)+1;
    this.saleMusic?.stop();this.saleMusic=null;
    if(on&&this.ctx)this.native('fire_sale_music',.35,true).then(source=>{if(token!==this.saleToken)source.stop();else this.saleMusic=source;}).catch(console.error);
  }
  // Low-health heartbeat loop. Only latches once the context exists, so a call before start() is retried.
  heartbeat(on){
    if(on&&(!this.ctx||!this.manifest.heartbeat))return;
    if(!!this.beatOn===on)return;this.beatOn=on;const token=this.beatToken=(this.beatToken??0)+1;
    try{this.beatSource?.stop();}catch{}this.beatSource=null;
    if(on)this.native('heartbeat',.45,true).then(source=>{if(token!==this.beatToken){try{source.stop();}catch{}}else this.beatSource=source;}).catch(console.error);
  }
  // Sniper scope breathing: breath in on aim, breath out on release, a gasp after a long hold.
  scopeBreath(def,aiming){
    const sniper=weaponFolder(def?.id)?.startsWith('sniper/');
    if(!sniper){this.scopeSince=null;return;}
    let cue='scope_breath_in';
    if(aiming){this.scopeSince=performance.now();this.zoom(def);}
    else{cue=this.scopeSince!=null&&performance.now()-this.scopeSince>4000?'scope_breath_gasp':'scope_breath_out';this.scopeSince=null;}
    if(this.manifest[cue])this.play(cue,.6);
  }
  pause(){this.ctx?.suspend();}
  dispose(){this.voices.clear();this.tracked.clear();this.musicToken++;try{this.music?.stop();}catch{}this.music=null;try{this.saleMusic?.stop();}catch{}this.saleMusic=null;this.beatToken=(this.beatToken??0)+1;try{this.beatSource?.stop();}catch{}this.beatSource=null;this.beatOn=false;this.buffers.clear();this.bufferSizes.clear();this.bufferBytes=0;this.variants.clear();const ctx=this.ctx;this.ctx=null;this.master=null;ctx?.close?.().catch(()=>{});}
  async buffer(key,priority='high'){
    if(this.buffers.has(key)){const cached=this.buffers.get(key);this.buffers.delete(key);this.buffers.set(key,cached);return cached;}
    const pending=fetch(this.manifest[key].url,{priority}).then(r=>{if(!r.ok)throw new Error('Audio '+key+' HTTP '+r.status);return r.arrayBuffer();}).then(b=>this.ctx.decodeAudioData(b)).then(buffer=>{
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
  async native(key,volume=1,loop=false,position=null,locate=null,maxWait=0){
    const asked=performance.now(),b=await this.buffer(key);
    if(maxWait){
      if(!this.ctx||performance.now()-asked>maxWait)return null;
      const now=this.ctx.currentTime;if(now-(this.lastStart.get(key)??-1)<.03)return null;this.lastStart.set(key,now);
    }
    const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=b;source.loop=loop;gain.gain.value=volume;source.connect(gain);
    const panner=position&&this.camera?this.panner(position):null;
    if(panner){gain.connect(panner);panner.connect(this.master);this.spatial.add(source);if(locate)this.tracked.set(source,{panner,locate});this.syncListener();this.watchListener();}else gain.connect(this.master);
    source.onended=()=>{this.spatial.delete(source);this.tracked.delete(source);source.disconnect();gain.disconnect();panner?.disconnect();};
    source.start();this.played.push(key);if(this.played.length>30)this.played.shift();return source;
  }
  panner(position){
    const p=this.ctx.createPanner(),[x,y,z]=Array.isArray(position)?position:[position.x,position.y,position.z];
    p.panningModel='equalpower';p.distanceModel='inverse';p.refDistance=SPATIAL.near;p.rolloffFactor=SPATIAL.rolloff;p.maxDistance=SPATIAL.far;
    if(p.positionX){p.positionX.value=x;p.positionY.value=y;p.positionZ.value=z;}else p.setPosition(x,y,z);
    return p;
  }
  place(p,position){
    const [x,y,z]=Array.isArray(position)?position:[position.x,position.y,position.z];
    if(p.positionX){p.positionX.value=x;p.positionY.value=y;p.positionZ.value=z;}else p.setPosition(x,y,z);
  }
  dogCues(){return this.dogVoices??=dogCues(Object.keys(this.manifest).filter(k=>/^ref\/(aml\/dog|evt\/zombie_(tron|global)\/hellhounds)\//.test(k)));}
  zombieCues(){return this.zombieVoices??=zombieCues(Object.keys(this.manifest).filter(k=>k.startsWith('ref/vox/zmb/')));}
  // One-shot zombie voice (attack, death, spawn) from the enemy's position.
  zombieEvent(type,kind,position,gain=1,cause=''){
    const cues=kind==='dog'?this.dogCues():this.zombieCues()[kind==='nova'?'nova':'zombie'];
    if(kind==='dog'&&type==='step'){const step=this.pick(cues.step),collar=this.pick(cues.collar);if(step)this.play(step,.6*gain,position);if(collar&&Math.random()<.3)this.play(collar,.3*gain,position);return;}
    const key=this.pick(type==='death'&&cause==='electric'&&cues.elec?.length?cues.elec:cues[type]);
    if(key)this.play(key,.8*gain,position);
  }
  voice(gait,locate,kind='zombie'){
    if(!this.enabled||!this.ctx||this.ctx.state!=='running'||!this.camera)return null;
    const origin=locate(),m=this.camera.matrixWorld.elements;
    if(Math.hypot(origin.x-m[12],origin.y-m[13],origin.z-m[14])>VOICE_RANGE||this.voices.size>=VOICE_LIMIT)return null;
    const cues=kind==='dog'?this.dogCues():this.zombieCues()[kind==='nova'?'nova':'zombie'];
    let pool=cues[gait]??cues.walk;
    if(kind==='dog'&&cues.close.length&&Math.random()<.5){const dx=origin.x-m[12],dz=origin.z-m[14];if(Math.hypot(dx,dz)<400)pool=cues.close;}
    else if(cues.behind?.length&&Math.random()<.5){
      // A zombie close behind the player gets the 'behind' callouts.
      const dx=origin.x-m[12],dz=origin.z-m[14],len=Math.hypot(dx,dz)||1;
      if(len<350&&(dx*-m[8]+dz*-m[10])/len<-.3)pool=cues.behind;
    }
    const key=this.pick(pool);
    if(!key)return null;
    const handle={ended:false,stopped:false,source:null,key,stop(){this.stopped=true;try{this.source?.stop();}catch{}}};
    const finish=()=>{handle.ended=true;this.voices.delete(handle);};
    this.voices.add(handle);
    this.native(key,gait==='sprint'?.8:.7,false,origin,locate).then(source=>{
      handle.source=source;const previous=source.onended;
      source.onended=()=>{previous?.call(source);finish();};
      if(handle.stopped)source.stop();
    }).catch(()=>finish());
    return handle;
  }
  syncListener(){
    const cam=this.camera,l=this.ctx?.listener;if(!cam||!l)return;
    cam.updateWorldMatrix(true,false);const m=cam.matrixWorld.elements;
    if(l.positionX){l.positionX.value=m[12];l.positionY.value=m[13];l.positionZ.value=m[14];l.forwardX.value=-m[8];l.forwardY.value=-m[9];l.forwardZ.value=-m[10];l.upX.value=m[4];l.upY.value=m[5];l.upZ.value=m[6];}
    else{l.setPosition(m[12],m[13],m[14]);l.setOrientation(-m[8],-m[9],-m[10],m[4],m[5],m[6]);}
  }
  watchListener(){
    if(this.watching)return;this.watching=true;
    const tick=()=>{if(!this.ctx||!this.spatial.size){this.watching=false;return;}this.syncListener();for(const t of this.tracked.values())this.place(t.panner,t.locate());requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
  }
  async playMusic(key){if(!this.ctx)return;const token=++this.musicToken;this.music?.stop();this.music={stop(){}};let music;try{music=await this.native(key,key==='ambience'?.18:.65,key==='ambience');}catch(error){console.warn('Music '+key+' could not be decoded',error);return;}if(token!==this.musicToken){music.stop();return;}this.music=music;}
  play(kind,volume=1,position=null){
    if(!this.enabled||!this.ctx||this.ctx.state!=='running')return;
    if(this.manifest[kind]){this.native(kind,volume*.8,false,position,null,this.staleLimit(kind)).catch(console.error);return;}
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

import * as THREE from 'three';

// The sky image contains the native star field in the left half and the Earth
// horizon in the right half. Keep the Earth as its separate native vista layer.
export class MoonPresentation {
  constructor(scene,camera,features){Object.assign(this,{scene,camera,features});this.stage=null;this.flashColor=-1;this.diggers={};}
  async load(){
    const loader=new THREE.TextureLoader();
    [this.skyTexture,this.earthTexture,this.destroyedTexture]=await Promise.all(['skybox_zom_moon_ft','moon_vista_earth_c','moon_vista_earth_destroyed'].map(n=>loader.loadAsync('moon/textures/'+n+'.png')));
    for(const t of [this.skyTexture,this.earthTexture,this.destroyedTexture])t.colorSpace=THREE.SRGBColorSpace;
    this.skyTexture.repeat.set(.495,1);
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(45000,32,20),new THREE.MeshBasicMaterial({map:this.skyTexture,side:THREE.BackSide,depthWrite:false,toneMapped:false,color:0x697b95}));
    this.sky.renderOrder=-10;this.sky.visible=false;this.scene.add(this.sky);
    this.earth=new THREE.Mesh(new THREE.PlaneGeometry(10000,10000),new THREE.MeshBasicMaterial({map:this.earthTexture,transparent:true,alphaTest:.015,depthWrite:false,toneMapped:false}));this.earth.renderOrder=-9;this.earth.visible=false;this.scene.add(this.earth);
    this.lights=Array.from({length:4},()=>{const l=new THREE.PointLight(0xc5def2,0,300,1);this.scene.add(l);return l;});
    this.lamps=this.features.data.entities.filter(e=>e.classname==='light'&&e.position&&e.radius&&Number(e.radius)<1800);
    this.rockets=this.features.all('vista_rocket').map(e=>({e,object:this.features.objects.get(e.id)}));
  }
  reset(){this.stage=null;this.flashColor=-1;this.diggers={};for(const {e,object}of this.rockets)if(object)object.position.fromArray(e.position);}
  update(dt,environment){
    const f=this.features,q=f.quest,a=f.combat.audio,lunar=environment.lunar;
    this.sky.visible=this.earth.visible=lunar;
    if(lunar){this.sky.position.copy(this.camera.position);this.earth.position.copy(this.camera.position).add(new THREE.Vector3(12500,22500,-18500));this.earth.lookAt(this.camera.position);}
    const destroyed=q.completed||q.stage==='launch'&&q.stageTime>=14;
    this.earth.material.map=destroyed?this.destroyedTexture:this.earthTexture;
    const flash=document.getElementById('earth-flash');if(flash)flash.style.opacity=q.stage==='launch'&&q.stageTime>=14?String(Math.max(0,.85-(q.stageTime-14)*.4)):'0';
    if(q.stage==='launch')for(const {e,object}of this.rockets)if(object){const age=Math.max(0,q.stageTime-2);object.position.fromArray(e.position);object.position.y+=age*age*100;object.position.x+=age*age*40;}
    const lamps=environment.breathable&&f.s.power?this.lamps.filter(e=>Math.abs(e.position[0]-this.camera.position.x)<900&&Math.abs(e.position[2]-this.camera.position.z)<900).sort((a,b)=>new THREE.Vector3(...a.position).distanceToSquared(this.camera.position)-new THREE.Vector3(...b.position).distanceToSquared(this.camera.position)):[];
    this.lights.forEach((l,i)=>{const e=lamps[i];l.intensity=e?12:0;if(e){l.position.fromArray(e.position);l.distance=Math.min(700,Number(e.radius));const c=(e._color??'.65 .8 1').split(' ').map(Number);l.color.setRGB(...c);}});
    if(this.stage!==q.stage){
      this.stage=q.stage;
      const cue={security:'hack/evt_moon_hacker_open',buttons:'_sidequest/hacks/evt_correct_hack_00',tank:'_sidequest/sq/evt_tube_move_up',switch:'_sidequest/sq/evt_souls_full',plates:'pyramid_open',charge:'_sidequest/vril/evt_vril_start',tanks:'_sidequest/assemble/evt_casimir_charge',swap:'_sidequest/sq/evt_souls_full',final_simon:'_sidequest/sq/evt_souls_flush',launch:'_sidequest/rocket/evt_rocket_launch',complete:'_sidequest/rocket/evt_earth_explode'}[q.stage];if(cue)a.cue(cue);
    }
    for(const [id,d]of Object.entries(q.diggers))if(this.diggers[id]!==d.phase){
      this.diggers[id]=d.phase;const n={hangar:1,teleporter:2,biodome:3}[id],event=d.phase==='warning'?'start':d.phase==='digging'?'breach':'hacked';
      if(q.elapsed>1)a.play(`moon/vox/scripted/zombie_moon/mcomp/vox_mcomp_digger_${n}_${event}`,.85);
    }
    const visible=f.simonLights.findIndex(s=>s.light.intensity>0);
    if(visible!==this.flashColor){this.flashColor=visible;if(visible>=0)a.cue('_sidequest/samanthasays/evt_ss_'+['lo_g','c','d','e'][visible]);}
  }
}

import { MOON_PERKS } from './moon-session.js';

const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export const DIGGERS = {
  hangar:{name:'Pi',label:'Tunnel 6',zones:['cata_left_middle_zone','cata_left_start_zone'],switch:'hangar_digger_switch',blocker:'digger_hangar_blocker',damage:'digger_hangar_dmg'},
  teleporter:{name:'Omicron',label:'Tunnel 11',zones:['cata_right_start_zone','cata_right_middle_zone','cata_right_end_zone'],switch:'teleporter_digger_switch',blocker:'digger_teleporter_blocker',damage:'digger_teleporter_dmg'},
  biodome:{name:'Epsilon',label:'Biodome',zones:['forest_zone'],switch:'biodome_digger_switch'},
};

// The state machine is independent of rendering. All quest locations and sphere
// path nodes come from the retained map entities, and timers stop when paused.
export class MoonProgression {
  constructor(data,session,notice=()=>{}){this.data=data;this.s=session;this.notice=notice;this.reset();}
  all(name){return this.data.entities.filter(e=>e.targetname===name);}
  one(name){return this.all(name)[0];}
  reset(){
    this.stage='power';this.elapsed=0;this.stageTime=0;this.powerRound=null;this.powerTime=null;this.lastDiggerRound=null;
    this.diggers=Object.fromEntries(Object.keys(DIGGERS).map(id=>[id,{phase:'idle',left:0,breached:false}]));
    this.breaches=new Set();this.piBreached=false;this.history=[];this.security=new Set();this.buttons=new Set();
    this.sequence=[];this.sequenceLength=1;this.sequenceInput=0;this.sequenceShowUntil=0;this.finalGame=0;
    this.sphereNode=null;this.spherePosition=null;this.sphereMoving=false;this.sphereWait=0;
    this.plates='earth';this.wire=false;this.generator=false;this.charge=0;this.tanks=[0,0,0,0];
    this.hackerId=this.all('zombie_equipment_upgrade').filter(e=>e.zombie_equipment_upgrade==='equip_hacker_zm')[Math.floor(this.s.random()*6)]?.id;
    const wires=this.all('sq_wire_pos');this.wireId=wires[Math.floor(this.s.random()*wires.length)]?.id;
    this.musicEggs=new Set();this.completed=false;
  }
  advance(stage,message){this.history.push({stage:this.stage,time:this.elapsed});this.stage=stage;this.stageTime=0;if(message)this.notice(message,7);}
  startSimon(final=false){
    this.sequence=Array.from({length:final?[6,7,8][this.finalGame]:6},()=>Math.floor(this.s.random()*4));
    this.sequenceLength=final?[3,4,5][this.finalGame]:1;this.sequenceInput=0;
    this.sequenceShowUntil=this.elapsed+this.sequenceLength*.8+1;
  }
  pressSimon(color){
    if(!['simon','final_simon'].includes(this.stage)||this.elapsed<this.sequenceShowUntil)return false;
    if(color!==this.sequence[this.sequenceInput]){
      this.sequenceInput=0;this.sequenceShowUntil=this.elapsed+this.sequenceLength*.8+1;this.notice('Incorrect sequence. Watch the screens and try again.');return false;
    }
    if(++this.sequenceInput<this.sequenceLength)return true;
    this.sequenceInput=0;
    if(this.sequenceLength<this.sequence.length){this.sequenceLength++;this.sequenceShowUntil=this.elapsed+this.sequenceLength*.8+1;return true;}
    if(this.stage==='simon')this.advance('security_start','Access granted. Find the Hacker in the laboratories.');
    else if(++this.finalGame<3)this.startSimon(true);
    else this.advance('final_qed','Launch codes accepted. Throw a QED at the sphere beside the MPD.');
    return true;
  }
  startSecurity(){
    if(this.stage!=='security_start'||!this.s.hacker||!this.s.spend(500))return false;
    const choices=this.all('struct_osc_st').slice();
    for(let i=choices.length-1;i>0;i--){const j=Math.floor(this.s.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];}
    this.securityTargets=choices.slice(0,4).map(e=>e.id);this.security.clear();
    this.advance('security','Hack the four green laboratory terminals within 70 seconds.');return true;
  }
  hackSecurity(id){
    if(this.stage!=='security'||!this.s.hacker||!this.securityTargets.includes(id)||this.security.has(id))return false;
    this.security.add(id);
    if(this.security.size===4){this.buttons.clear();this.advance('buttons','Press all four laboratory buttons within 3.5 seconds.');}
    return true;
  }
  pressButton(id){
    if(this.stage!=='buttons'||this.buttons.has(id))return false;
    if(!this.buttons.size)this.stageTime=0;
    this.buttons.add(id);
    if(this.buttons.size===4){this.advance('excavator','Security released. Allow excavator Pi to breach Tunnel 6, then hack its console in Receiving Bay.');this.checkSphere();}
    return true;
  }
  activateDigger(id){
    const d=this.diggers[id];if(!d||d.phase!=='idle')return false;
    d.phase='warning';d.left=240;this.lastDiggerRound=this.s.round;
    this.notice(`Warning: excavator ${DIGGERS[id].name} will breach ${DIGGERS[id].label} in four minutes. Hack its Receiving Bay console to stop it.`,10);return true;
  }
  hackDigger(id){
    const d=this.diggers[id];if(!this.s.hacker||!d||d.phase==='idle')return false;
    d.phase='idle';d.left=0;this.s.addPoints(1000);this.notice(`Excavator ${DIGGERS[id].name} retracted. +1000 points.`,6);this.checkSphere();return true;
  }
  checkSphere(){
    if(this.stage==='excavator'&&this.piBreached&&this.diggers.hangar.phase==='idle'){
      this.sphereNode=this.one('vs_stage_1a');this.spherePosition=this.sphereNode.position.slice();
      this.advance('sphere','The Vril Sphere is in Tunnel 6. Strike it with your knife and follow it.');
    }
  }
  motivateSphere(cause){
    if(this.stage!=='sphere'||this.sphereMoving||this.sphereWait>0)return false;
    const requirement=this.sphereNode.script_string??'';
    const valid=requirement==='zap'?cause==='wave':requirement.includes('MELEE')?cause==='melee':requirement.includes('GRENADE')&&!requirement.includes('BULLET')?cause==='grenade':requirement.includes('EXPLOSIVE')&&!requirement.includes('BULLET')?['grenade','explosion','wave'].includes(cause):['bullet','wave','grenade','explosion','melee'].includes(cause);
    if(!valid){this.notice(requirement==='zap'?'Use the Wave Gun on the sphere above Receiving Bay.':requirement.includes('MELEE')?'Strike the sphere with your knife.':'Use a grenade to move the sphere.');return false;}
    this.sphereMoving=true;this.sphereWait=.2;return true;
  }
  updateSphere(dt){
    if(this.stage!=='sphere'||!this.sphereMoving)return;
    this.sphereWait=Math.max(0,this.sphereWait-dt);if(this.sphereWait)return;
    const next=this.one(this.sphereNode.target??this.sphereNode.script_parameters);
    if(!next){this.sphereMoving=false;return;}
    const d=distance(this.spherePosition,next.position),step=dt*320;
    if(d>step){this.spherePosition=this.spherePosition.map((v,i)=>v+(next.position[i]-v)*step/d);return;}
    this.spherePosition=next.position.slice();this.sphereNode=next;
    if(next.script_flag==='complete_be_1'){
      this.sphereMoving=false;this.tanks=[0,0,0,0];this.advance('tank','The sphere is seated. Kill 25 zombies near the first MPD soul collector.');
    }else if(next.script_string){this.sphereMoving=false;this.notice(next.script_string==='zap'?'The sphere is above Receiving Bay. Shoot it with the Wave Gun.':'The sphere has stopped. Strike or shoot it to continue.');}
  }
  kill(position,kind,cause){
    if(!['tank','tanks'].includes(this.stage)||kind==='astronaut'||cause==='wave')return null;
    const tanks=[this.one('sq_first_tank'),...this.all('sq_second_tank')],count=this.stage==='tank'?1:4;
    for(let i=0;i<count;i++)if(this.tanks[i]<25&&Math.abs(position[1]-tanks[i].position[1])<110&&Math.hypot(position[0]-tanks[i].position[0],position[2]-tanks[i].position[2])<=225){
      this.tanks[i]++;
      if(this.tanks.slice(0,count).every(n=>n>=25))this.advance(this.stage==='tank'?'switch':'swap',this.stage==='tank'?'Collector charged. Use the switch beside the pyramid.':'All four collectors charged. Insert the charged Vril Device into the MPD.');
      return tanks[i].position;
    }
    return null;
  }
  useSwitch(){
    if(this.stage!=='switch')return false;
    this.s.effects.death_machine=this.s.time+90;
    this.advance('plates','Cryogenic Slumber Party. Recover the plates from the shelf in Area 51 with a grenade, then a Gersh Device.');return true;
  }
  blast(position,cause){
    if(this.stage==='sphere'&&this.spherePosition&&distance(position,this.spherePosition)<250)this.motivateSphere(cause);
    if(this.stage==='plates'&&this.plates==='earth'&&cause==='grenade'&&distance(position,this.one('sq_cassimir_plates').position)<300){this.plates='loose';this.notice('Plates dislodged. Throw a Gersh Device beside them.');return true;}
    if(this.stage==='plates'&&this.plates==='loose'&&cause==='gersh'&&distance(position,this.one('sq_cassimir_plates').position)<400){this.plates='receiving';this.notice('Plates transferred to Receiving Bay. Move them onto the workbench with a QED.');return true;}
    if(this.stage==='plates'&&this.plates==='receiving'&&cause==='qed'&&distance(position,this.one('sq_ctvg_tp2').position)<300){this.plates='bench';this.advance('wire','Find the wire in the laboratories, then assemble the Vril Device at the Receiving Bay terminal.');return true;}
    if(this.stage==='final_qed'&&cause==='qed'&&distance(position,this.one('sq_pyramid_console').position)<300){this.spherePosition=this.one('be2_pos').position.slice();this.advance('final_gersh','The sphere returned to the computers. Throw a Gersh Device beside it.');return true;}
    if(this.stage==='final_gersh'&&cause==='gersh'&&distance(position,this.one('be2_pos').position)<400){this.advance('launch','Missiles armed. Stand by for launch.');return true;}
    return false;
  }
  takeWire(id){if(this.stage!=='wire'||id!==this.wireId||this.wire)return false;this.wire=true;this.notice('Wire recovered. Return to the Receiving Bay terminal.');return true;}
  chargeDevice(dt){
    if(this.stage==='wire'&&this.wire){this.advance('charge','Hold F at the terminal to charge the Vril Device.');return true;}
    if(this.stage!=='charge')return false;
    this.charge=Math.min(60,this.charge+dt);
    if(this.charge===60){this.generator=true;this.tanks=[0,0,0,0];this.advance('tanks','Vril Device charged. Fill all four MPD collectors with 25 souls each.');}
    return true;
  }
  swap(){
    if(this.stage!=='swap')return false;
    this.s.permanentPerks=true;this.s.perks=new Set(Object.keys(MOON_PERKS));this.s.health=this.s.maxHealth;
    this.advance('final_simon','Soul exchange complete. All eight perks are permanent. Return to the color computers for three final sequences.');this.startSimon(true);return true;
  }
  update(dt){
    this.elapsed+=dt;this.stageTime+=dt;
    if(this.s.power&&this.powerRound===null){this.powerRound=this.s.round;this.powerTime=this.elapsed;this.lastDiggerRound=this.s.round;}
    if(this.stage==='power'&&this.s.power){this.advance('simon','Power restored. Repeat the flashing sequence at the four computers outside Receiving Bay.');this.startSimon();}
    if(this.stage==='security'&&this.stageTime>70){this.security.clear();this.advance('security_start','Security timed out. Hack a laboratory button to try again.');}
    if(this.stage==='buttons'&&this.buttons.size&&this.stageTime>3.5){this.buttons.clear();this.notice('Button window missed. Press all four again.');}
    if(this.powerRound!==null&&this.elapsed-this.powerTime>=20&&this.s.round-this.lastDiggerRound>=(this.lastDiggerRound===this.powerRound?2:4)){
      const choices=Object.keys(DIGGERS).filter(id=>this.diggers[id].phase==='idle');
      if(choices.length)this.activateDigger(!this.piBreached&&choices.includes('hangar')?'hangar':choices[Math.floor(this.s.random()*choices.length)]);
    }
    for(const [id,d] of Object.entries(this.diggers))if(d.phase==='warning'){
      d.left=Math.max(0,d.left-dt);
      if(!d.left){d.phase='digging';d.breached=true;for(const zone of DIGGERS[id].zones)this.breaches.add(zone);if(id==='hangar')this.piBreached=true;this.notice(`${DIGGERS[id].label} breached. Oxygen lost. Retract excavator ${DIGGERS[id].name} from Receiving Bay.`,10);}
    }
    this.updateSphere(dt);
    if(this.stage==='launch'&&this.stageTime>=18){this.completed=true;this.advance('complete','Big Bang Theory complete. Earth is destroyed. Continue surviving with permanent perks.');}
  }
  objective(){
    const goals={power:'Restore power in the MPD room.',simon:'Repeat the six-color sequence outside Receiving Bay.',security_start:'Find the Hacker; hack a laboratory button (500 points).',security:`Hack the four green terminals: ${this.security.size}/4 · ${Math.max(0,Math.ceil(70-this.stageTime))}s`,buttons:`Press the four laboratory buttons: ${this.buttons.size}/4`,excavator:'Let Pi breach Tunnel 6, then hack its Receiving Bay console.',sphere:this.sphereNode?.script_string==='zap'?'Shoot the sphere above Receiving Bay with the Wave Gun.':'Follow the Vril Sphere through the tunnels to the MPD.',tank:`Fill the first MPD collector: ${this.tanks[0]}/25 souls.`,switch:'Use the switch beside the MPD.',plates:this.plates==='earth'?'Grenade the Area 51 plates on the shelf.':this.plates==='loose'?'Throw a Gersh Device beside the Area 51 plates.':'Throw a QED beside the plates in Receiving Bay.',wire:this.wire?'Connect the wire at the Receiving Bay terminal.':'Find the wire in the laboratories.',charge:`Hold F at the Receiving Bay terminal: ${Math.floor(this.charge)}/60s`,tanks:`Fill the four MPD collectors: ${this.tanks.map(n=>n+'/25').join(' · ')}`,swap:'Insert the charged Vril Device into the MPD.',final_simon:`Repeat the final color sequences: ${this.finalGame+1}/3`,final_qed:'Throw a QED beside the sphere at the MPD.',final_gersh:'Throw a Gersh Device beside the sphere at the color computers.',launch:'Missiles launching. Watch Earth.',complete:'Big Bang Theory complete. Survive as long as you can.'};
    return goals[this.stage];
  }
  snapshot(){return {stage:this.stage,objective:this.objective(),completed:this.completed,elapsed:this.elapsed,diggers:structuredClone(this.diggers),breaches:[...this.breaches],tanks:this.tanks.slice(),plates:this.plates,wire:this.wire,charge:this.charge,sequence:this.sequence.slice(),sequenceLength:this.sequenceLength,sequenceInput:this.sequenceInput,spherePosition:this.spherePosition?.slice(),sphereNode:this.sphereNode?.id,security:[...this.security],securityTargets:this.securityTargets};}
}

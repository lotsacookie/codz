// Reel selection and the four return rooms follow zombie_theater_movie_screen.gsc.
export class KinoEvents {
  constructor(data,random=Math.random){this.data=data;this.random=random;this.reset();}
  reset(){
    const groups=['clean_bedroom','bear_bedroom','interrogation','pentagon'];
    for(let i=groups.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[groups[i],groups[j]]=[groups[j],groups[i]];}
    this.reels=groups.slice(0,3).map((group,i)=>{const candidates=this.data.entities.filter(e=>e.targetname==='trigger_movie_reel_'+group);return {entity:candidates[Math.floor(this.random()*candidates.length)],film:i+1,collected:false};});
    this.carried=null;this.installed=new Set();this.film=0;this.room=null;this.roomUntil=0;
  }
  available(id){return !this.carried&&this.reels.some(r=>r.entity.id===id&&!r.collected);}
  take(id){const reel=this.reels.find(r=>r.entity.id===id);if(!this.available(id))return false;reel.collected=true;this.carried=reel.film;return true;}
  install(){if(!this.carried)return false;this.film=this.carried;this.installed.add(this.carried);this.carried=null;return true;}
  chooseRoom(){if(this.random()<.25)return null;const rooms=this.data.entities.filter(e=>/^ee_teleport_player[0-3]$/.test(e.targetname));return rooms[Math.floor(this.random()*rooms.length)];}
  snapshot(){return {reels:this.reels.map(r=>({id:r.entity.id,position:r.entity.position,film:r.film,collected:r.collected})),carried:this.carried,installed:[...this.installed],film:this.film,room:this.room?.targetname??null,roomUntil:this.roomUntil};}
}

import * as THREE from 'three';
import { init, importNavMesh, NavMeshQuery } from '@recast-navigation/core';

export class MoonNavigation {
  constructor(data) { this.data=data; this.regions={}; this.area='earth'; this.disabled=new Set(); }
  async load() {
    await init();
    const checked = async url => {const r=await fetch(url);if(!r.ok)throw new Error(url+': '+r.status);return r;};
    const [earth,moon,metadata]=await Promise.all(['moon/navigation-earth.bin','moon/navigation-moon.bin','moon/navigation.json'].map(checked));
    this.metadata=await metadata.json();
    for(const [name,response] of [['earth',earth],['moon',moon]]){
      const {navMesh}=importNavMesh(new Uint8Array(await response.arrayBuffer()));
      const query=new NavMeshQuery(navMesh,{maxNodes:8192}); query.defaultQueryHalfExtents={x:60,y:90,z:60};
      this.regions[name]={navMesh,query};
    }
  }
  get query(){return this.regions[this.area].query;}
  // Navigation queries must never throw into the game loop: a failed query is simply "no route".
  closest(p,extents){try{const r=this.query.findClosestPoint(p,extents?{halfExtents:extents}:undefined);return r.success?new THREE.Vector3(r.point.x,r.point.y,r.point.z):null;}catch{return null;}}
  path(a,b){try{const r=this.query.computePath(a,b);return r.success?r.path.map(p=>new THREE.Vector3(p.x,p.y,p.z)):[];}catch{return [];}}
  setDoors(parts){
    const {navMesh,query}=this.regions.moon;
    for(const ref of this.disabled)navMesh.setPolyFlags(ref,1);this.disabled.clear();
    for(const part of parts.values()){
      if(part.amount>=1)continue;
      const box=part.collider.geometry.boundingBox;
      if(!box)continue;
      const center=box.getCenter(new THREE.Vector3()),extent=box.getSize(new THREE.Vector3()).multiplyScalar(.5);extent.x+=2;extent.z+=2;
      for(const ref of query.queryPolygons(center,extent).polyRefs??[])this.disabled.add(ref);
    }
    for(const ref of this.disabled)navMesh.setPolyFlags(ref,0);
  }
  activeZones(session){
    if(session.area==='earth')return new Set(['nml_zone']);
    const zones=new Set(['bridge_zone']);let changed=true;
    while(changed){changed=false;for(const [a,b,flag]of this.data.zoneLinks)if((session.flags.has(flag)||flag==='digsite_group')&&(zones.has(a)||zones.has(b))){if(!zones.has(a)||!zones.has(b))changed=true;zones.add(a);zones.add(b);}}
    return zones;
  }
}

import fs from 'node:fs';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
await init();const {navMesh}=importNavMesh(new Uint8Array(fs.readFileSync('export/web/assets/navigation.bin')));const q=new NavMeshQuery(navMesh,{maxNodes:16384});q.defaultQueryHalfExtents={x:70,y:100,z:70};
const sites={lobby:[-115,72,1254],lobbyCenter:[0,100,1100],lowerDoor:[-580,100,641],upperDoor:[582,340,641],vip:[1100,340,700],dining:[1300,0,-400],dressing:[1100,0,-1350],stage:[-488,0,-1246],theater:[0,0,100],alley:[-1500,0,0]};
const p=a=>({x:a[0],y:a[1],z:a[2]});
const results=[];
for(const [name,a]of Object.entries(sites)){const c=q.findClosestPoint(p(a));const route=q.computePath(p(sites.lobby),p(a));results.push({name,closest:c.point,poly:c.polyRef,success:route.success,length:route.path?.length,last:route.path?.at(-1)});}
console.log(JSON.stringify(results,null,2));fs.writeFileSync('artifacts/nav-routes.json',JSON.stringify(results,null,2));

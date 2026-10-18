import { CATALOG, species } from '../data/catalog.ts';
import { BATH_COST, CAPACITY, FILTER_COST, FILTER_POWER, FOOD, FOOD_LIFETIME, GACHA, MILESTONES, MOTION, MOTION_OVERRIDES, PELLET_LIFETIME, RARITIES, RARITY, waterBounds } from '../data/balance.ts';
import { getFishAnatomy, getFishAvoidanceBox, getFishModelScale, writeFishMouthWorld } from '../data/fish-anatomy.ts';
import { FLOOR_Y, getScrubCellMask, isInsideWater, waterSignedDistance, WATER_Y } from './water.ts';
import type { ActionResult, FishPose, FishState, GameAction, GameEvent, Gate, RunState, SaveV1, SpeciesSpec, Tier, Vec3 } from './types.ts';
export const clamp = (n:number,lo:number,hi:number):number => Math.max(lo,Math.min(hi,n));
export function getFishStats(spec:SpeciesSpec,growth:number) {
 const b=RARITY[spec.rarity], factor=.9+.05*(spec.index%5);
 return {incomePerMinute:b.income*factor*(.1+.9*growth),appetite:b.appetite*(.7+.3*growth),saleValue:Math.floor(b.sale*(1+3*growth)),growthSeconds:(60+15*(spec.index%9))*60};
}
export function getCleanliness(run:RunState):number {return 100*(1-run.dirt.reduce((a,b)=>a+b,0)/20);}
export function getCapacity(run:RunState):number {return CAPACITY[run.bathLevel];}
export function getIncomePerMinute(run:RunState,fish:FishState):number {return getFishStats(species(fish.speciesId),fish.growth).incomePerMinute*clamp(fish.hunger/30,0,1)*(.5+.5*getCleanliness(run)/100);}
function nextId(run:RunState):string {
 let id:string;
 do {id=`${run.id}-${run.nextId++}`;} while(run.fish.some(f=>f.id===id)||run.foodBags.some(b=>b.id===id)||run.pellets.some(p=>p.id===id));
 return id;
}
function makeFish(run:RunState,speciesId:string,growth=0):FishState {
 const n=run.nextId, b=waterBounds(run.bathLevel);
 return {id:nextId(run),speciesId,growth,hunger:100,starvingSeconds:0,coinCredit:0,dropSeconds:0,position:[Math.sin(n*2.4)*b.x*.55,.72+(n%3)*.06,Math.cos(n*2.4)*b.z*.55],heading:n*2.4,phase:n};
}
export function createGame(nowMs:number,seed:number):SaveV1 {
 const run:RunState={id:`run-${Math.floor(nowMs)}-${seed>>>0}`,wallet:300,pendingCoins:0,activeSeconds:0,resumeGraceSeconds:0,fish:[],foodBags:[],pellets:[],dirt:Array<number>(20).fill(.05),bathLevel:0,filterLevel:0,totalFed:0,adultsRaised:0,claimedMilestones:[],rngState:(seed>>>0)||1,nextId:1};
 run.fish.push(makeFish(run,'guppy',1),makeFish(run,'goldfish'),makeFish(run,'hammerhead'));
 run.foodBags.push({id:nextId(run),remaining:10,expiresAtActiveSeconds:FOOD_LIFETIME});
 return {version:1,savedAtMs:nowMs,settings:{language:'vi',muted:false},discovered:['guppy','goldfish','hammerhead'],run};
}
export function restartGame(save:SaveV1,nowMs:number,seed:number):SaveV1 {
 const next=createGame(nowMs,seed); next.discovered=[...new Set([...save.discovered,...next.discovered])]; next.settings={...save.settings}; return next;
}
export function isGateOpen(run:RunState,gate:Gate):boolean {
 switch(gate){case'none':return true;case'raised-1':return run.adultsRaised>=1;case'raised-3':return run.adultsRaised>=3;case'raised-6':return run.adultsRaised>=6;case'filter-2':return run.filterLevel>=2;case'bath-3':return run.bathLevel>=3;case'bath-max':return run.bathLevel===4;}
}
export function getGachaOdds(save:SaveV1,tier:Tier):{rarity:typeof RARITIES[number];probability:number;speciesIds:string[]}[] {
 const eligible=CATALOG.filter(s=>s.acquisition!=='milestone'&&isGateOpen(save.run,s.gate));
 const rows=RARITIES.map((rarity,i)=>({rarity,probability:GACHA[tier].weights[i],speciesIds:eligible.filter(s=>s.rarity===rarity).map(s=>s.id)})).filter(r=>r.probability>0&&r.speciesIds.length>0);
 const sum=rows.reduce((a,r)=>a+r.probability,0); return rows.map(r=>({...r,probability:r.probability/sum}));
}
function random(run:RunState):number {let x=run.rngState;x^=x<<13;x^=x>>>17;x^=x<<5;run.rngState=x>>>0;return run.rngState/4294967296;}
function acquire(save:SaveV1,speciesId:string):GameEvent {
 const fish=makeFish(save.run,speciesId);save.run.fish.push(fish);if(!save.discovered.includes(speciesId))save.discovered.push(speciesId);
 return {type:'fish-acquired',fishId:fish.id,speciesId};
}
export function isBankrupt(save:SaveV1):boolean {return save.run.fish.length===0&&save.run.wallet+save.run.pendingCoins<100&&!MILESTONES.some(m=>m.ready(save)&&!save.run.claimedMilestones.includes(m.id));}
interface FishMotion {
 previous:FishPose;
 speed:number; verticalSpeed:number; turnRate:number;
 waypoint:Vec3;
 waypointSerial:number;
 waypointAge:number;
 waypointTimeout:number;
 waypointHeading:number|null;
 hasWaypoint:boolean;
 pelletId:string|null; approachHeading:number;
 cruise:number; chase:number; beat:number; scale:number;
 corners:Float64Array; safeMin:number; safeMax:number;
 oldHunger:number; hungerRate:number; growthSeconds:number;
}
interface RunMotion {
 fish:Map<string,FishMotion>; ordered:FishState[]; live:Set<string>;
 reservations:Set<string>; pellets:Map<string,RunState['pellets'][number]>;
}
const motion=new WeakMap<RunState,RunMotion>();
function hash01(text:string):number {
 let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0)/4294967296;
}
function getRunMotion(run:RunState):RunMotion {
 let runtime=motion.get(run);
 if(!runtime){runtime={fish:new Map(),ordered:[],live:new Set(),reservations:new Set(),pellets:new Map()};motion.set(run,runtime);}
 return runtime;
}
function writePose(out:FishPose,run:RunState,fish:FishState):void {
 out.x=fish.position[0];out.y=fish.position[1];out.z=fish.position[2];out.heading=fish.heading;out.phase=fish.phase;out.growth=fish.growth;out.atActiveSeconds=run.activeSeconds;
}
function getFishMotion(runtime:RunMotion,run:RunState,fish:FishState):FishMotion {
 let record=runtime.fish.get(fish.id);
 if(!record){
  const spec=species(fish.speciesId),settings=MOTION[spec.family],override=MOTION_OVERRIDES[spec.id],individual=.94+.12*hash01(fish.id);
  if(!settings)throw new Error(`Missing fish motion: ${spec.id}`);
  const previous:FishPose={x:0,y:0,z:0,heading:0,phase:0,growth:0,atActiveSeconds:0};writePose(previous,run,fish);
  record={previous,speed:0,verticalSpeed:0,turnRate:0,waypoint:[0,0,0],waypointSerial:0,waypointAge:0,waypointTimeout:0,waypointHeading:null,hasWaypoint:false,pelletId:null,approachHeading:fish.heading,
   cruise:settings.cruise*(override?.[0]??1)*individual,chase:settings.chase*(override?.[1]??1)*individual,beat:settings.beat*(override?.[2]??1)*individual,scale:getFishModelScale(spec,fish.growth),
   corners:new Float64Array(24),safeMin:-.15,safeMax:.9,oldHunger:fish.hunger,hungerRate:0,growthSeconds:1};
  runtime.fish.set(fish.id,record);
 }
 return record;
}
export function getPreviousFishPose(run:RunState,fish:FishState):Readonly<FishPose> {
 return getFishMotion(getRunMotion(run),run,fish).previous;
}
export function collapseMotionInterpolation(run:RunState):void {
 const runtime=getRunMotion(run);for(const fish of run.fish)writePose(getFishMotion(runtime,run,fish).previous,run,fish);
}
export function resetRunRuntime(run:RunState):void {motion.delete(run);scrubbed.delete(run);}
const mouthWorld:Vec3=[0,0,0];
function cellIndex(run:RunState,x:number,z:number):number {const b=waterBounds(run.bathLevel);return clamp(Math.floor((x+b.x)/(2*b.x)*5),0,4)+5*clamp(Math.floor((z+b.z)/(2*b.z)*4),0,3);}
const scrubbed=new WeakMap<RunState,{at:number;amounts:number[]}>();
export function applyScrubMask(run:RunState,mask:number):void {
 if(!Number.isSafeInteger(mask)||mask<0)return;mask&=0xfffff;
 let record=scrubbed.get(run);if(!record||record.at!==run.activeSeconds){record={at:run.activeSeconds,amounts:Array<number>(20).fill(0)};scrubbed.set(run,record);}
 for(let i=0;i<20;i++)if(mask&(1<<i)){const amount=Math.min(run.dirt[i],.15-record.amounts[i]);run.dirt[i]-=amount;record.amounts[i]+=amount;}
}
export function dispatchAction(save:SaveV1,action:GameAction):ActionResult {
 const r=save.run, events:GameEvent[]=[];
 const fail=(code:Extract<ActionResult,{ok:false}>['code']):ActionResult=>({ok:false,code});
 const before=MILESTONES.filter(m=>m.ready(save)).map(m=>m.id);
 switch(action.type){
 case'buy-food':{const food=FOOD[action.size];if(r.wallet<food.cost)return fail('insufficient-coins');r.wallet-=food.cost;r.foodBags.push({id:nextId(r),remaining:food.portions,expiresAtActiveSeconds:r.activeSeconds+FOOD_LIFETIME});break;}
 case'drop-food':{if(!isInsideWater(r.bathLevel,action.x,action.z))return fail('outside-water');const bag=r.foodBags.filter(b=>b.remaining>0&&b.expiresAtActiveSeconds>r.activeSeconds).sort((a,b)=>a.expiresAtActiveSeconds-b.expiresAtActiveSeconds||a.id.localeCompare(b.id))[0];if(!bag)return fail('no-food');bag.remaining--;r.pellets.push({id:nextId(r),position:[action.x,WATER_Y,action.z],ttlSeconds:PELLET_LIFETIME});break;}
 case'collect-all':r.wallet+=r.pendingCoins;r.pendingCoins=0;break;
 case'scrub':{if(!isInsideWater(r.bathLevel,action.x,action.z))return fail('outside-water');applyScrubMask(r,getScrubCellMask(r.bathLevel,action.x,action.z));break;}
 case'sell':{const index=r.fish.findIndex(f=>f.id===action.fishId);if(index<0)return fail('unknown-fish');const fish=r.fish[index],amount=getFishStats(species(fish.speciesId),fish.growth).saleValue;r.wallet+=amount;r.fish.splice(index,1);motion.get(r)?.fish.delete(fish.id);events.push({type:'fish-sold',fishId:fish.id,speciesId:fish.speciesId,amount});break;}
 case'upgrade-bath':{if(r.bathLevel>=4)return fail('max-level');const cost=BATH_COST[r.bathLevel];if(r.wallet<cost)return fail('insufficient-coins');r.wallet-=cost;r.bathLevel++;break;}
 case'upgrade-filter':{if(r.filterLevel>=4)return fail('max-level');const cost=FILTER_COST[r.filterLevel];if(r.wallet<cost)return fail('insufficient-coins');r.wallet-=cost;r.filterLevel++;break;}
 case'roll':{const tier=GACHA[action.tier];if(!tier.ready(save))return fail('locked');if(r.wallet<tier.cost)return fail('insufficient-coins');if(r.fish.length>=getCapacity(r))return fail('full-bath');const odds=getGachaOdds(save,action.tier);if(!odds.length)return fail('locked');r.wallet-=tier.cost;const draw=random(r);let cumulative=0;let selected=odds[odds.length-1];for(const row of odds){cumulative+=row.probability;if(draw<cumulative){selected=row;break;}}events.push(acquire(save,selected.speciesIds[Math.floor(random(r)*selected.speciesIds.length)]));break;}
 case'claim-milestone':{const milestone=MILESTONES.find(m=>m.id===action.milestoneId);if(!milestone)return fail('locked');if(r.claimedMilestones.includes(milestone.id))return fail('already-claimed');if(!milestone.ready(save))return fail('not-ready');if(r.fish.length>=getCapacity(r))return fail('full-bath');r.claimedMilestones.push(milestone.id);events.push(acquire(save,milestone.speciesId));break;}
 }
 for(const m of MILESTONES)if(!before.includes(m.id)&&m.ready(save)&&!r.claimedMilestones.includes(m.id))events.push({type:'milestone-ready',milestoneId:m.id});
 return {ok:true,events};
}
function angleDelta(target:number,current:number):number {return Math.atan2(Math.sin(target-current),Math.cos(target-current));}
/** Same T(mouth) Rx(pitch) Rz(bank) T(-mouth) transform as the render rig. */
function writeEnvelope(spec:SpeciesSpec,m:FishMotion,heading:number):void {
 const box=getFishAvoidanceBox(spec),mouth=getFishAnatomy(spec).mouth;
 const pitch=spec.family==='seahorse'?0:clamp(-Math.atan2(m.verticalSpeed,Math.max(m.speed,.05)),-.20,.20);
 const bank=spec.family==='seahorse'?0:clamp(-.08*m.turnRate,spec.family==='ray'?-.08:-.16,spec.family==='ray'?.08:.16);
 const cp=Math.cos(pitch),sp=Math.sin(pitch),cb=Math.cos(bank),sb=Math.sin(bank),ch=Math.cos(heading),sh=Math.sin(heading);
 let minY=Infinity,maxY=-Infinity;
 for(let i=0;i<8;i++){
  const x=(i&1?box.max[0]:box.min[0])-mouth[0],y=(i&2?box.max[1]:box.min[1])-mouth[1],z=(i&4?box.max[2]:box.min[2])-mouth[2];
  const bx=cb*x-sb*y,by=sb*x+cb*y;
  const rx=bx+mouth[0],ry=cp*by-sp*z+mouth[1],rz=sp*by+cp*z+mouth[2],offsetY=m.scale*ry;
  m.corners[i*3]=m.scale*(ch*rx+sh*rz);m.corners[i*3+1]=offsetY;m.corners[i*3+2]=m.scale*(-sh*rx+ch*rz);
  minY=Math.min(minY,offsetY);maxY=Math.max(maxY,offsetY);
 }
 m.safeMin=Math.max(-.15,FLOOR_Y+.03-minY);m.safeMax=Math.min(.9,WATER_Y-.03-maxY);
 if(m.safeMin>m.safeMax){const middle=clamp((m.safeMin+m.safeMax)/2,-.15,.9);m.safeMin=middle;m.safeMax=middle;}
}
function horizontalEnvelopeViolation(run:RunState,m:FishMotion,x:number,z:number):number {
 let violation=0;
 for(let i=0;i<24;i+=3){const d=Math.max(0,waterSignedDistance(run.bathLevel,x+m.corners[i],z+m.corners[i+2])+.06);violation+=d*d;}
 return violation;
}
function envelopeViolation(run:RunState,m:FishMotion,x:number,y:number,z:number):number {
 const dy=y-clamp(y,m.safeMin,m.safeMax);return horizontalEnvelopeViolation(run,m,x,z)+dy*dy;
}
function chooseWaypoint(run:RunState,fish:FishState,m:FishMotion):void {
 const spec=species(fish.speciesId),b=waterBounds(run.bathLevel),oldX=m.waypointSerial>0?m.waypoint[0]:fish.position[0],oldY=m.waypointSerial>0?m.waypoint[1]:fish.position[1],oldZ=m.waypointSerial>0?m.waypoint[2]:fish.position[2];
 m.waypointSerial++;m.waypointAge=0;m.waypointTimeout=3+3*hash01(`timeout:${fish.id}:${m.waypointSerial}`);m.waypointHeading=null;
 const depthMin=spec.family==='ray'?.08:spec.family==='seahorse'?.50:.72,depthMax=spec.family==='ray'?.35:spec.family==='seahorse'?.80:.90;
 for(let candidate=0;candidate<8;candidate++){
  const key=`${fish.id}:${m.waypointSerial}:${candidate}`,x=(hash01(`x:${key}`)*2-1)*b.x*.88,z=(hash01(`z:${key}`)*2-1)*b.z*.88;
  const heading=Math.atan2(x-fish.position[0],z-fish.position[2]);writeEnvelope(spec,m,heading);
  const lo=Math.max(depthMin,m.safeMin),hi=Math.min(depthMax,m.safeMax),y=lo<=hi?lo+(hi-lo)*hash01(`y:${key}`):clamp((depthMin+depthMax)/2,m.safeMin,m.safeMax);
  if(Math.hypot(x-oldX,y-oldY,z-oldZ)<.6||envelopeViolation(run,m,x,y,z)>1e-12)continue;
  m.waypoint[0]=x;m.waypoint[1]=y;m.waypoint[2]=z;m.hasWaypoint=true;return;
 }
 // A conservative appendage envelope need not fit at every yaw. Find a useful
 // center heading, but never lock the physical turn or shrink the actual fish.
 let bestHeading=0,bestY=0,bestViolation=Infinity,bestAngle=Infinity,bestFit=false;
 for(let i=0;i<36;i++){
  const heading=i*Math.PI/18;writeEnvelope(spec,m,heading);
  const y=clamp((depthMin+depthMax)/2,m.safeMin,m.safeMax),violation=envelopeViolation(run,m,0,y,0),fit=violation<=1e-12,angle=Math.abs(angleDelta(heading,fish.heading));
  if((fit&&!bestFit)||(fit===bestFit&&(fit?angle<bestAngle-1e-12:violation<bestViolation-1e-12||(Math.abs(violation-bestViolation)<=1e-12&&angle<bestAngle-1e-12)))){
   bestFit=fit;bestHeading=heading;bestY=y;bestViolation=violation;bestAngle=angle;
  }
 }
 m.waypoint[0]=0;m.waypoint[1]=bestY;m.waypoint[2]=0;m.waypointHeading=bestHeading;m.hasWaypoint=true;
}
function assignPellets(run:RunState,runtime:RunMotion,dt:number):void {
 runtime.reservations.clear();runtime.pellets.clear();
 for(const pellet of run.pellets)if(pellet.ttlSeconds>0)runtime.pellets.set(pellet.id,pellet);
 // Retained reservations have first refusal; hunger/ID only resolves conflicts.
 for(const fish of runtime.ordered){
  const m=runtime.fish.get(fish.id)!;
  if(m.pelletId!==null){
   if(m.oldHunger-m.hungerRate*dt>=70||!runtime.pellets.has(m.pelletId)||runtime.reservations.has(m.pelletId)){m.pelletId=null;chooseWaypoint(run,fish,m);}
   else runtime.reservations.add(m.pelletId);
  }
 }
 for(const fish of runtime.ordered){
  const m=runtime.fish.get(fish.id)!;if(m.pelletId!==null||m.oldHunger-m.hungerRate*dt>=70)continue;
  writeFishMouthWorld(mouthWorld,species(fish.speciesId),fish.growth,fish.position,fish.heading);
  let closest:RunState['pellets'][number]|undefined,distance=Infinity;
  for(const pellet of run.pellets){
   if(runtime.reservations.has(pellet.id)||pellet.ttlSeconds<=0)continue;
   const d=Math.hypot(pellet.position[0]-mouthWorld[0],pellet.position[1]-mouthWorld[1],pellet.position[2]-mouthWorld[2]);
   if(d<distance||(d===distance&&closest!==undefined&&pellet.id.localeCompare(closest.id)<0)){closest=pellet;distance=d;}
  }
  if(closest){m.pelletId=closest.id;m.approachHeading=Math.atan2(closest.position[0]-fish.position[0],closest.position[2]-fish.position[2]);runtime.reservations.add(closest.id);}
 }
}
function moveFish(run:RunState,runtime:RunMotion,fish:FishState,dt:number):void {
 const m=runtime.fish.get(fish.id)!,spec=species(fish.speciesId),settings=MOTION[spec.family],p=m.previous,b=waterBounds(run.bathLevel);
 const pellet=m.pelletId===null?undefined:runtime.pellets.get(m.pelletId);
 let tx:number,ty:number,tz:number,mouthDistance=Infinity;
 if(pellet){
  const mouth=getFishAnatomy(spec).mouth,ch=Math.cos(m.approachHeading),sh=Math.sin(m.approachHeading);
  tx=pellet.position[0]-m.scale*(mouth[0]*ch+mouth[2]*sh);ty=pellet.position[1]-m.scale*mouth[1];tz=pellet.position[2]-m.scale*(-mouth[0]*sh+mouth[2]*ch);
  writeFishMouthWorld(mouthWorld,spec,fish.growth,fish.position,fish.heading);
  mouthDistance=Math.hypot(pellet.position[0]-mouthWorld[0],pellet.position[1]-mouthWorld[1],pellet.position[2]-mouthWorld[2]);
 }else{
  if(m.hasWaypoint)m.waypointAge+=dt;
  if(!m.hasWaypoint||m.waypointAge>=m.waypointTimeout||(Math.hypot(m.waypoint[0]-p.x,m.waypoint[1]-p.y,m.waypoint[2]-p.z)<=.18&&(m.waypointHeading===null||Math.abs(angleDelta(m.waypointHeading,p.heading))<=.18)))chooseWaypoint(run,fish,m);
  tx=m.waypoint[0];ty=m.waypoint[1];tz=m.waypoint[2];
 }
 writeEnvelope(spec,m,p.heading);
 const horizontalRecover=horizontalEnvelopeViolation(run,m,p.x,p.z)>1e-12||!isInsideWater(run.bathLevel,p.x,p.z);
 if(horizontalRecover){tx=0;tz=0;}
 ty=clamp(horizontalRecover||p.y<m.safeMin||p.y>m.safeMax?p.y:ty,m.safeMin,m.safeMax);
 let dx=tx-p.x,dz=tz-p.z;
 const targetLength=Math.hypot(dx,dz);if(targetLength>1e-9){dx/=targetLength;dz/=targetLength;}
 else{dx=Math.sin(p.heading);dz=Math.cos(p.heading);}
 // All neighbor coordinates and scales are tick-start data, independent of
 // care order, array order and which neighbor has already moved this tick.
 let sx=0,sy=0,sz=0;
 for(const other of runtime.ordered){
  if(other===fish)continue;const neighbor=runtime.fish.get(other.id)!,q=neighbor.previous,radius=.20+.10*(m.scale+neighbor.scale);
  let ox=p.x-q.x,oy=p.y-q.y,oz=p.z-q.z,d=Math.hypot(ox,oy,oz);
  if(d>=radius)continue;
  if(d<1e-12){
   const first=fish.id.localeCompare(other.id)<0,key=first?`${fish.id}|${other.id}`:`${other.id}|${fish.id}`,sign=first?1:-1,angle=hash01(key)*Math.PI*2;
   ox=Math.sin(angle)*sign;oz=Math.cos(angle)*sign;oy=(hash01(`${key}:y`)-.5)*sign;d=Math.hypot(ox,oy,oz);
   sx+=ox/d;sy+=oy/d;sz+=oz/d;
  }else{const strength=(1-d/radius)/d;sx+=ox*strength;sy+=oy*strength;sz+=oz*strength;}
 }
 const separationLength=Math.hypot(sx,sy,sz),separationLimit=pellet&&mouthDistance<.35?.225:.45;
 if(separationLength>0){const influence=Math.min(separationLimit,separationLength)/separationLength;dx+=sx*influence;dz+=sz*influence;ty+=sy*influence*.3;}
 const predictX=p.x+Math.sin(p.heading)*m.speed*.45,predictZ=p.z+Math.cos(p.heading)*m.speed*.45;
 const predicted=horizontalEnvelopeViolation(run,m,predictX,predictZ);
 if(predicted>1e-12){
  const gx=horizontalEnvelopeViolation(run,m,predictX+.04,predictZ)-horizontalEnvelopeViolation(run,m,predictX-.04,predictZ),gz=horizontalEnvelopeViolation(run,m,predictX,predictZ+.04)-horizontalEnvelopeViolation(run,m,predictX,predictZ-.04),length=Math.hypot(gx,gz);
  if(length>1e-12){const strength=Math.min(2,Math.sqrt(predicted)*4);dx-=gx/length*strength;dz-=gz/length*strength;}
 }
 let desiredHeading=Math.atan2(dx,dz);
 if(!horizontalRecover&&pellet&&Math.hypot(tx-p.x,ty-p.y,tz-p.z)<.4)desiredHeading=m.approachHeading;
 else if(!pellet&&m.waypointHeading!==null&&targetLength<.18)desiredHeading=m.waypointHeading;
 const error=angleDelta(desiredHeading,p.heading),desiredTurn=Math.sign(error)*Math.min(settings.maxYaw,Math.abs(error)/dt,Math.sqrt(20*Math.abs(error)));
 m.turnRate+=clamp(desiredTurn-m.turnRate,-10*dt,10*dt);m.turnRate=clamp(m.turnRate,-settings.maxYaw,settings.maxYaw);
 fish.heading=p.heading+m.turnRate*dt;
 let desiredSpeed=pellet?Math.min(m.chase,Math.sqrt(2*settings.brake*Math.max(mouthDistance-.10,0))):m.cruise;
 desiredSpeed*=Math.max(.2,Math.cos(error));
 m.speed+=clamp(desiredSpeed-m.speed,-settings.brake*dt,settings.acceleration*dt);
 ty=clamp(ty,m.safeMin,m.safeMax);
 const desiredY=clamp((ty-p.y)*3,-settings.vertical,settings.vertical);
 // Recovery must brake an upward cruise and begin descending within one tick.
 const verticalAcceleration=p.y<m.safeMin||p.y>m.safeMax?2.4:1.2;
 m.verticalSpeed+=clamp(desiredY-m.verticalSpeed,-verticalAcceleration*dt,verticalAcceleration*dt);
 writeEnvelope(spec,m,fish.heading);
 let nx=clamp(p.x+Math.sin(fish.heading)*m.speed*dt,-b.x,b.x),nz=clamp(p.z+Math.cos(fish.heading)*m.speed*dt,-b.z,b.z),ny=clamp(p.y+m.verticalSpeed*dt,-.15,.9);
 if(isInsideWater(run.bathLevel,p.x,p.z)){
  if(!isInsideWater(run.bathLevel,nx,nz)){
   let lo=0,hi=1;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(isInsideWater(run.bathLevel,p.x+(nx-p.x)*mid,p.z+(nz-p.z)*mid))lo=mid;else hi=mid;}
   nx=p.x+(nx-p.x)*lo;nz=p.z+(nz-p.z)*lo;
  }
 }else if(waterSignedDistance(run.bathLevel,nx,nz)>waterSignedDistance(run.bathLevel,p.x,p.z)+1e-9){
  // Old rectangular saves may start outside the rounded water. Reject only
  // the outward component, rather than bisecting from an invalid origin.
  const start=waterSignedDistance(run.bathLevel,p.x,p.z),xOnly=waterSignedDistance(run.bathLevel,nx,p.z),zOnly=waterSignedDistance(run.bathLevel,p.x,nz);
  if(xOnly<=start+1e-9&&(xOnly<=zOnly||zOnly>start+1e-9))nz=p.z;else if(zOnly<=start+1e-9)nx=p.x;else{nx=p.x;nz=p.z;}
 }
 const oldViolation=envelopeViolation(run,m,p.x,p.y,p.z);
 if(oldViolation>1e-12&&envelopeViolation(run,m,nx,ny,nz)>oldViolation+1e-9){
  const oldYError=Math.abs(p.y-clamp(p.y,m.safeMin,m.safeMax)),newYError=Math.abs(ny-clamp(ny,m.safeMin,m.safeMax));
  if(newYError>oldYError+1e-9)ny=p.y;
  if(envelopeViolation(run,m,nx,ny,nz)>oldViolation+1e-9){
   const xOnly=envelopeViolation(run,m,nx,ny,p.z),zOnly=envelopeViolation(run,m,p.x,ny,nz);
   if(xOnly<=oldViolation+1e-9&&(xOnly<=zOnly||zOnly>oldViolation+1e-9))nz=p.z;else if(zOnly<=oldViolation+1e-9)nx=p.x;else{nx=p.x;nz=p.z;}
  }
 }
 fish.position[0]=nx;fish.position[1]=ny;fish.position[2]=nz;
 m.speed=Math.hypot(nx-p.x,nz-p.z)/dt;m.verticalSpeed=(ny-p.y)/dt;
 const actualSpeed=Math.hypot(nx-p.x,ny-p.y,nz-p.z)/dt;
 fish.phase+=Math.PI*2*m.beat*clamp(actualSpeed/m.cruise,.45,1.5)*dt;
}
export function step(run:RunState,dtSeconds:number):GameEvent[] {
 if(!Number.isFinite(dtSeconds)||dtSeconds<=0)return [];
 const events:GameEvent[]=[],oldFed=run.totalFed,oldAdults=run.adultsRaised,runtime=getRunMotion(run);
 runtime.ordered.length=0;runtime.live.clear();
 // Snapshot before advancing the active clock or changing care/growth.
 for(const fish of run.fish){
  const m=getFishMotion(runtime,run,fish),spec=species(fish.speciesId),stats=getFishStats(spec,fish.growth);
  writePose(m.previous,run,fish);m.scale=getFishModelScale(spec,fish.growth);m.oldHunger=fish.hunger;m.hungerRate=10*stats.appetite/60;m.growthSeconds=stats.growthSeconds;
  runtime.ordered.push(fish);runtime.live.add(fish.id);
 }
 for(const id of runtime.fish.keys())if(!runtime.live.has(id))runtime.fish.delete(id);
 runtime.ordered.sort((a,b)=>a.hunger-b.hunger||a.id.localeCompare(b.id));
 const protectedDt=Math.min(dtSeconds,run.resumeGraceSeconds);run.resumeGraceSeconds=Math.max(0,run.resumeGraceSeconds-dtSeconds);run.activeSeconds+=dtSeconds;
 const cleanFactor=.5+.5*getCleanliness(run)/100;
 for(let i=run.foodBags.length-1;i>=0;i--){const bag=run.foodBags[i];if(run.activeSeconds+1e-8>=bag.expiresAtActiveSeconds){if(bag.remaining>0)events.push({type:'food-expired',bagId:bag.id,amount:bag.remaining});run.foodBags.splice(i,1);}}
 for(let i=run.pellets.length-1;i>=0;i--){const p=run.pellets[i];p.ttlSeconds-=dtSeconds;p.position[1]=Math.max(-.15,p.position[1]-.08*dtSeconds);if(p.ttlSeconds<=0){const cell=cellIndex(run,p.position[0],p.position[2]);run.dirt[cell]=clamp(run.dirt[cell]+.1,0,1);run.pellets.splice(i,1);}}
 assignPellets(run,runtime,dtSeconds);
 for(const fish of runtime.ordered)moveFish(run,runtime,fish,dtSeconds);
 // Eating remains available to every touching eligible fish, not just the
 // reservation owner, with the original pre-depletion hunger/ID priority.
 for(const fish of runtime.ordered){
  const m=runtime.fish.get(fish.id)!,spec=species(fish.speciesId),oldHunger=m.oldHunger,hungerRate=m.hungerRate;
  fish.hunger=Math.max(0,oldHunger-hungerRate*dtSeconds);
  if(fish.hunger<70){
   writeFishMouthWorld(mouthWorld,spec,fish.growth,fish.position,fish.heading);
   const index=run.pellets.findIndex(p=>Math.hypot(p.position[0]-mouthWorld[0],p.position[1]-mouthWorld[1],p.position[2]-mouthWorld[2])<=.18);
   if(index>=0){const eaten=run.pellets[index];run.pellets.splice(index,1);runtime.pellets.delete(eaten.id);fish.hunger=Math.min(100,fish.hunger+30);fish.starvingSeconds=0;run.totalFed++;}
  }
  if(fish.hunger===0){const zeroAt=oldHunger/hungerRate;fish.starvingSeconds+=Math.max(0,dtSeconds-Math.max(protectedDt,zeroAt));}else fish.starvingSeconds=0;
  const h=clamp(fish.hunger/30,0,1);
  fish.coinCredit+=getIncomePerMinute(run,fish)*dtSeconds/60;
  if(fish.growth<1){fish.growth=Math.min(1,fish.growth+h*cleanFactor*dtSeconds/m.growthSeconds);if(fish.growth>=1){run.adultsRaised++;events.push({type:'fish-grown',fishId:fish.id,speciesId:fish.speciesId});}}
  fish.dropSeconds+=dtSeconds;if(fish.dropSeconds+1e-8>=20){fish.dropSeconds%=20;const amount=Math.floor(fish.coinCredit);fish.coinCredit-=amount;run.pendingCoins+=amount;if(amount>0)events.push({type:'coin-drop',fishId:fish.id,amount});}
  if(fish.starvingSeconds+1e-8>=180){run.fish.splice(run.fish.indexOf(fish),1);runtime.fish.delete(fish.id);events.push({type:'fish-left',fishId:fish.id,speciesId:fish.speciesId});}
 }
 for(const fish of run.fish){const m=runtime.fish.get(fish.id)!;if(m.pelletId!==null&&(!runtime.pellets.has(m.pelletId)||fish.hunger>=70)){m.pelletId=null;m.scale=getFishModelScale(species(fish.speciesId),fish.growth);chooseWaypoint(run,fish,m);}}
 const dirtRate=(.0035*run.fish.length-FILTER_POWER[run.filterLevel]/100)/60;
 for(let i=0;i<20;i++)run.dirt[i]=clamp(run.dirt[i]+dirtRate*dtSeconds,0,1);
 if(oldFed<10&&run.totalFed>=10&&!run.claimedMilestones.includes('fed-10'))events.push({type:'milestone-ready',milestoneId:'fed-10'});
 for(const n of [1,3])if(oldAdults<n&&run.adultsRaised>=n&&!run.claimedMilestones.includes(`raised-${n}`))events.push({type:'milestone-ready',milestoneId:`raised-${n}`});
 return events;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScrubMask, collapseMotionInterpolation, createGame, dispatchAction, getCapacity, getCleanliness, getFishStats, getGachaOdds, getPreviousFishPose, isBankrupt, resetRunRuntime, restartGame, step } from './engine.ts';
import { species } from '../data/catalog.ts';
import type { SaveV1 } from './types.ts';
import { getScrubCellMask, isInsideWater, waterSignedDistance } from './water.ts';
import { getFishAnatomy, getFishModelScale, writeFishMouthWorld } from '../data/fish-anatomy.ts';
import { waterBounds } from '../data/balance.ts';
function advance(s:SaveV1,seconds:number):void {for(let n=0;n<Math.round(seconds/.05);n++)step(s.run,.05);}
test('collect is idempotent and bags retain separate active expiration',()=>{
 const s=createGame(1000,11);s.run.pendingCoins=37;dispatchAction(s,{type:'collect-all'});dispatchAction(s,{type:'collect-all'});assert.equal(s.run.wallet,337);assert.equal(s.run.pendingCoins,0);
 advance(s,10);dispatchAction(s,{type:'buy-food',size:'small'});assert.equal(s.run.wallet,307);assert.equal(s.run.foodBags[0].expiresAtActiveSeconds,7200);assert.ok(Math.abs(s.run.foodBags[1].expiresAtActiveSeconds-7210)<1e-6);
 s.run.activeSeconds=7199.9;step(s.run,.05);assert.equal(s.run.foodBags.length,2);const events=step(s.run,.05);assert.equal(s.run.foodBags.length,1);assert.equal(events.find(e=>e.type==='food-expired')?.amount,10);
});
test('starvation has per-step shared resume grace and leaves only after 180 active seconds',()=>{
 const s=createGame(1000,12);s.run.fish.forEach(f=>{f.hunger=0;f.starvingSeconds=178});s.run.resumeGraceSeconds=60;
 advance(s,60);assert.equal(s.run.fish.length,3);s.run.fish.forEach(f=>assert.ok(Math.abs(f.starvingSeconds-178)<1e-6));advance(s,1.95);assert.equal(s.run.fish.length,3);advance(s,.05);assert.equal(s.run.fish.length,0);assert.equal(s.discovered.length,3);
});
test('outside feed does not consume; hungry fish reaches and consumes a real pellet exactly once',()=>{
 const s=createGame(1000,13);s.run.fish=s.run.fish.slice(0,1);const f=s.run.fish[0];f.hunger=20;f.position=[0,.7,0];f.heading=0;
 const before=structuredClone(s);assert.deepEqual(dispatchAction(s,{type:'drop-food',x:100,z:0}),{ok:false,code:'outside-water'});assert.deepEqual(s,before);
 dispatchAction(s,{type:'drop-food',x:0,z:.15});assert.equal(s.run.foodBags[0].remaining,9);advance(s,8);assert.equal(s.run.totalFed,1);assert.equal(s.run.pellets.length,0);assert.ok(f.hunger>40);
});
test('scrubbing reflects touched cells and is limited to .15 per active step',()=>{
 const s=createGame(1000,14);s.run.dirt.fill(.8);const before=getCleanliness(s.run);dispatchAction(s,{type:'scrub',x:-1.7,z:-.7});const once=[...s.run.dirt];dispatchAction(s,{type:'scrub',x:-1.7,z:-.7});assert.deepEqual(s.run.dirt,once);assert.ok(getCleanliness(s.run)>before);assert.ok(s.run.dirt.some(v=>v===.8));
 step(s.run,.05);dispatchAction(s,{type:'scrub',x:-1.7,z:-.7});assert.ok(getCleanliness(s.run)>before);
});
test('selling acts on exact individual, permits last fish, bankruptcy respects pending and rewards',()=>{
 const s=createGame(1000,15),first=s.run.fish[0];s.run.fish[1].speciesId=first.speciesId;const amount=getFishStats(species(first.speciesId),first.growth).saleValue;dispatchAction(s,{type:'sell',fishId:first.id});assert.equal(s.run.wallet,300+amount);assert.equal(s.run.fish.length,2);assert.ok(s.run.fish.every(f=>f.id!==first.id));
 s.run.fish=[];s.run.wallet=0;assert.equal(isBankrupt(s),true);s.run.pendingCoins=100;assert.equal(isBankrupt(s),false);s.run.pendingCoins=0;s.run.totalFed=10;assert.equal(isBankrupt(s),false);
});
test('restart preserves discoveries and settings, resets run economy and starter growth counts',()=>{
 const s=createGame(1000,16);s.discovered.push('oarfish');s.settings={language:'en',muted:true};s.run.wallet=0;s.run.bathLevel=4;s.run.totalFed=20;s.run.adultsRaised=7;
 const n=restartGame(s,2000,17);assert.deepEqual(n.settings,s.settings);assert.ok(n.discovered.includes('oarfish'));assert.equal(n.run.wallet,300);assert.equal(n.run.fish.length,3);assert.equal(n.run.adultsRaised,0);assert.equal(n.run.bathLevel,0);assert.equal(n.run.foodBags[0].remaining,10);assert.equal(getCapacity(n.run),5);
});
test('failed gacha is atomic for wallet, RNG and fish',()=>{
 for(const reason of ['poor','full','locked'] as const){const s=createGame(1000,18);if(reason==='poor')s.run.wallet=0;if(reason==='full'){s.run.wallet=1000;while(s.run.fish.length<5)dispatchAction(s,{type:'roll',tier:'basic'});}const before=structuredClone(s);const result=dispatchAction(s,{type:'roll',tier:reason==='locked'?'premium':'basic'});assert.equal(result.ok,false);assert.deepEqual(s,before);}
});
test('each successful roll owns a new child even when species repeat and cannot exceed capacity',()=>{
 const s=createGame(1000,19);s.run.bathLevel=4;s.run.wallet=50000;for(let i=0;i<27;i++)assert.equal(dispatchAction(s,{type:'roll',tier:'basic'}).ok,true);
 assert.equal(s.run.fish.length,30);assert.equal(new Set(s.run.fish.map(f=>f.id)).size,30);assert.ok(new Set(s.run.fish.map(f=>f.speciesId)).size<30);assert.ok(s.run.fish.slice(3).every(f=>f.growth===0));const before=structuredClone(s);assert.deepEqual(dispatchAction(s,{type:'roll',tier:'basic'}),{ok:false,code:'full-bath'});assert.deepEqual(s,before);assert.ok(s.run.wallet>=0);
});
test('full-bath milestone preserves entitlement until a slot exists',()=>{
 const s=createGame(1000,20);s.run.wallet=2000;s.run.totalFed=10;dispatchAction(s,{type:'roll',tier:'basic'});dispatchAction(s,{type:'roll',tier:'basic'});const before=structuredClone(s);assert.deepEqual(dispatchAction(s,{type:'claim-milestone',milestoneId:'fed-10'}),{ok:false,code:'full-bath'});assert.deepEqual(s,before);dispatchAction(s,{type:'sell',fishId:s.run.fish[0].id});assert.equal(dispatchAction(s,{type:'claim-milestone',milestoneId:'fed-10'}).ok,true);assert.equal(s.run.fish.at(-1)?.speciesId,'seahorse');assert.ok(s.discovered.includes('seahorse'));assert.equal(dispatchAction(s,{type:'claim-milestone',milestoneId:'fed-10'}).ok,false);
});
test('growth crosses adulthood once, dirt and filter act without recurring charges',()=>{
 const s=createGame(1000,21);s.run.fish[1].growth=.99999;advance(s,2);assert.equal(s.run.adultsRaised,1);advance(s,2);assert.equal(s.run.adultsRaised,1);const wallet=s.run.wallet;s.run.dirt.fill(.5);s.run.filterLevel=4;const clean=getCleanliness(s.run);advance(s,5);assert.ok(getCleanliness(s.run)>clean);assert.equal(s.run.wallet,wallet);
});
test('gacha excludes reward-only and gated species even with discoveries from a prior run',()=>{
 const s=createGame(1000,22);s.discovered.push('whale-shark','thresher-shark','sawfish','oarfish');s.run.bathLevel=3;
 const initial=getGachaOdds(s,'legendary');assert.equal(initial.reduce((sum,row)=>sum+row.probability,0),1);assert.ok(initial.every(row=>!row.speciesIds.includes('whale-shark')&&!row.speciesIds.includes('thresher-shark')&&!row.speciesIds.includes('oarfish')));assert.deepEqual(initial.find(row=>row.rarity==='legendary')?.speciesIds,['sawfish']);
 s.run.bathLevel=4;s.run.adultsRaised=6;
 const unlocked=getGachaOdds(s,'legendary');assert.equal(unlocked.find(row=>row.rarity==='legendary')?.speciesIds.length,3);assert.ok(unlocked.every(row=>!row.speciesIds.includes('oarfish')));
});
test('new transactions cannot reuse imported entity IDs when the saved counter is behind',()=>{
 const s=createGame(1000,23);s.run.nextId=1;assert.equal(dispatchAction(s,{type:'buy-food',size:'small'}).ok,true);assert.equal(dispatchAction(s,{type:'roll',tier:'basic'}).ok,true);
 const ids=[...s.run.fish,...s.run.foodBags,...s.run.pellets].map(entity=>entity.id);assert.equal(new Set(ids).size,ids.length);
});
test('rounded water rejects invalid drops atomically and accepts the inner arc at every level',()=>{
 for(const level of [0,2,4]){
  const s=createGame(1000,24);s.run.bathLevel=level;const sx=(2.2+.35*level)/2.2,sz=1+.08*level;
  for(const [x,z] of [[2.19*sx,.99*sz],[NaN,0],[0,Infinity],[100,0]]){
   const before=structuredClone(s);assert.deepEqual(dispatchAction(s,{type:'drop-food',x,z}),{ok:false,code:'outside-water'});assert.deepEqual(s,before);assert.equal(isInsideWater(level,x,z),false);assert.ok(waterSignedDistance(level,x,z)>0);
  }
  assert.equal(dispatchAction(s,{type:'drop-food',x:2*sx,z:.8*sz}).ok,true);assert.equal(s.run.pellets.length,1);assert.equal(s.run.foodBags[0].remaining,9);assert.ok(waterSignedDistance(level,2*sx,.8*sz)<0);
 }
});
test('shared scrub mask changes only touched cells and shares the timestamp allowance',()=>{
 const s=createGame(1000,25);s.run.dirt.fill(.8);const mask=getScrubCellMask(0,-1.7,-.7);
 applyScrubMask(s.run,mask);dispatchAction(s,{type:'scrub',x:-1.7,z:-.7});
 for(let i=0;i<20;i++)assert.ok(Math.abs(s.run.dirt[i]-(mask&(1<<i)?.65:.8))<1e-12);
 const before=[...s.run.dirt];for(const invalid of [NaN,-1,.5,Infinity])applyScrubMask(s.run,invalid);assert.deepEqual(s.run.dirt,before);
});
test('previous pose is the start of the latest physics tick, collapse and reset preserve care',()=>{
 const s=createGame(1000,26),f=s.run.fish[0];assert.equal(getPreviousFishPose(s.run,f).atActiveSeconds,0);
 step(s.run,.05);step(s.run,.05);const start=structuredClone(f);step(s.run,.05);
 assert.deepEqual(getPreviousFishPose(s.run,f),{x:start.position[0],y:start.position[1],z:start.position[2],heading:start.heading,phase:start.phase,growth:start.growth,atActiveSeconds:.1});
 const before=structuredClone(s);collapseMotionInterpolation(s.run);assert.deepEqual(s,before);assert.equal(getPreviousFishPose(s.run,f).x,f.position[0]);
 resetRunRuntime(s.run);assert.equal(getPreviousFishPose(s.run,f).atActiveSeconds,s.run.activeSeconds);
});
test('mouth uses anatomical snout, model scale, and heading without allocating its output',()=>{
 const spec=species('copperband'),out:[number,number,number]=[0,0,0],scale=getFishModelScale(spec,1);
 writeFishMouthWorld(out,spec,1,[1,2,3],Math.PI/2);
 assert.ok(Math.abs(out[0]-(1+.49*scale))<1e-12);assert.ok(Math.abs(out[1]-(2-.025*scale))<1e-12);assert.equal(out[2],3);assert.equal(getFishAnatomy(spec).headZ,.28);
});

test('full nonnumeric fish IDs produce deterministic motion without drawing gacha RNG',()=>{
 const a=createGame(1000,101);a.run.bathLevel=4;
 a.run.fish.forEach((f,i)=>{f.id=['motion-alpha','motion-beta','motion-gamma'][i];f.hunger=20;});
 const b=structuredClone(a),rng=a.run.rngState;
 for(let tick=0;tick<240;tick++){
  if(tick===30||tick===100){
   for(const s of [a,b])assert.equal(dispatchAction(s,{type:'drop-food',x:.3,z:.2}).ok,true);
  }
  assert.deepEqual(step(a.run,.05),step(b.run,.05));
  assert.deepEqual(a,b,`deterministic state at tick ${tick}`);
  assert.equal(a.run.rngState,rng);
 }
});

test('vertical envelope recovery preserves horizontal cruise without drawing RNG or changing wallet',()=>{
 const control=createGame(1000,123);control.run.bathLevel=4;control.run.fish=control.run.fish.slice(0,1);
 const fish=control.run.fish[0];fish.id='vertical-recovery-fish';fish.speciesId='seahorse';fish.growth=1;fish.hunger=100;fish.position=[.8,.5,0];fish.heading=0;
 const high=structuredClone(control),wallet=control.run.wallet,rng=control.run.rngState;
 step(control.run,.05);step(high.run,.05);
 high.run.fish[0].position[1]=.9;
 const controlBefore=[...fish.position],highFish=high.run.fish[0],highBefore=[...highFish.position],controlHeading=fish.heading,highHeading=highFish.heading;
 step(control.run,.05);step(high.run,.05);
 assert.ok([...highFish.position,highFish.heading].every(Number.isFinite));
 assert.ok(highFish.position[1]<highBefore[1],'the high fish must descend');
 assert.ok(Math.hypot(...highFish.position.map((value,i)=>value-highBefore[i]))<.08,'recovery must not teleport');
 for(const axis of [0,2])assert.ok(Math.abs((highFish.position[axis]-highBefore[axis])-(fish.position[axis]-controlBefore[axis]))<1e-8,`axis ${axis} must retain cruise displacement`);
 assert.ok(Math.abs((highFish.heading-highHeading)-(fish.heading-controlHeading))<1e-8,'recovery must retain cruise heading');
 for(const save of [control,high]){assert.equal(save.run.wallet,wallet);assert.equal(save.run.rngState,rng);}
});

test('thirty exact-overlap fish separate finitely without leaving saved bounds',()=>{
 const s=createGame(1000,102);s.run.bathLevel=4;
 const template=structuredClone(s.run.fish[0]);
 s.run.fish=Array.from({length:30},(_,i)=>({...structuredClone(template),id:`overlap-${String.fromCharCode(65+i)}`,position:[0,.45,0] as [number,number,number]}));
 const bounds=waterBounds(4);
 for(let tick=0;tick<100;tick++){
  step(s.run,.05);
  for(const f of s.run.fish){
   assert.ok([...f.position,f.heading,f.phase].every(Number.isFinite),f.id);
   assert.ok(Math.abs(f.position[0])<=bounds.x&&Math.abs(f.position[2])<=bounds.z,f.id);
   assert.ok(f.position[1]>=-.15&&f.position[1]<=.9,f.id);
  }
 }
 const positions=s.run.fish.map(f=>f.position);
 for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
  assert.ok(Math.hypot(...positions[i].map((v,k)=>v-positions[j][k]))>1e-6,'no pair may remain exactly overlapped');
 }
 assert.ok(positions.some((a,i)=>positions.slice(i+1).some(b=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])>.1)),'exact overlaps must resolve into distinct positions');
});

for(const speciesId of ['copperband','seahorse','whale-shark','sawfish']){
 test(`${speciesId} reaches a nearby pellet with its anatomical mouth within twelve seconds`,()=>{
  const s=createGame(1000,103);s.run.bathLevel=4;s.run.fish=s.run.fish.slice(0,1);
  const fish=s.run.fish[0];fish.id=`pursuit-${speciesId}`;fish.speciesId=speciesId;fish.growth=1;fish.hunger=20;fish.position=[0,.35,-.45];fish.heading=0;
  const start=structuredClone(fish.position),pellet:[number,number,number]=[0,.65,.35];
  assert.ok(Math.hypot(...pellet.map((v,i)=>v-start[i]))<=1);
  s.run.pellets=[{id:'nearby-food',position:pellet,ttlSeconds:30}];
  const appetite=getFishStats(species(speciesId),1).appetite;
  for(let tick=0;tick<240;tick++){
   const previous=[...fish.position];step(s.run,.05);
   assert.ok(Math.hypot(...fish.position.map((v,i)=>v-previous[i]))<.08,'pursuit must not teleport');
  }
  assert.equal(s.run.totalFed,1);assert.equal(s.run.pellets.length,0);
  assert.ok(Math.abs(fish.hunger-(20+30-12*10*appetite/60))<1e-8,'exactly one portion after normal depletion');
 });
}

test('touching fish consume once by pre-depletion hunger then full ID regardless of array order',()=>{
 for(const tied of [false,true])for(const reversed of [false,true]){
  const s=createGame(1000,104);s.run.bathLevel=4;
  const template=structuredClone(s.run.fish[0]);template.growth=1;template.position=[0,.4,0];template.heading=0;
  s.run.fish=[{...structuredClone(template),id:'touch-alpha',hunger:tied?20:25},{...structuredClone(template),id:'touch-zeta',hunger:20}];
  if(reversed)s.run.fish.reverse();
  const pellet:[number,number,number]=[0,0,0];writeFishMouthWorld(pellet,species(template.speciesId),1,template.position,0);
  s.run.pellets=[{id:'shared-bite',position:pellet,ttlSeconds:30}];
  step(s.run,.05);
  assert.equal(s.run.totalFed,1);assert.equal(s.run.pellets.length,0);
  const winner=s.run.fish.find(f=>f.hunger>40);
  assert.equal(winner?.id,tied?'touch-alpha':'touch-zeta');
 }
});

test('one pellet leaves the unreserved majority on their own cruise traces',()=>{
 const cruise=createGame(1000,105);cruise.run.bathLevel=4;
 const template=structuredClone(cruise.run.fish[0]);
 cruise.run.fish=Array.from({length:30},(_,i)=>({...structuredClone(template),id:`school-${String.fromCharCode(65+i)}`,growth:.1,hunger:20,position:[-2.5+(i%6),.4,-.9+Math.floor(i/6)*.45] as [number,number,number],heading:0}));
 const pursuit=structuredClone(cruise);pursuit.run.pellets=[{id:'single-reservation',position:[0,.7,0],ttlSeconds:30}];
 const unchanged=new Set(cruise.run.fish.map(f=>f.id));
 let changed=false;
 for(let tick=0;tick<3;tick++){
  step(cruise.run,.05);step(pursuit.run,.05);
  for(let i=0;i<30;i++){
   const a=cruise.run.fish[i],b=pursuit.run.fish[i];
   if(a.heading!==b.heading||a.position.some((v,j)=>v!==b.position[j])){unchanged.delete(a.id);changed=true;}
  }
 }
 assert.ok(changed,'a pursuer must react to the pellet');
 assert.ok(unchanged.size>=25,`${unchanged.size} fish retained their independent cruise traces`);
});

test('collapse preserves steering and scrub allowance, while reset is isolated to the replaced run',()=>{
 const a=createGame(1000,106);advance(a,.5);const b=structuredClone(a);
 // Bring both independently created runtime records to the same deterministic state.
 resetRunRuntime(a.run);step(a.run,.05);step(b.run,.05);
 a.run.dirt.fill(.8);b.run.dirt.fill(.8);
 applyScrubMask(a.run,1);applyScrubMask(b.run,1);
 const before=structuredClone(a);collapseMotionInterpolation(a.run);assert.deepEqual(a,before);
 applyScrubMask(a.run,1);assert.ok(Math.abs(a.run.dirt[0]-.65)<1e-12);
 step(a.run,.05);step(b.run,.05);assert.deepEqual(a,b,'collapse must not reset velocity, waypoint, or care');
 const imported=structuredClone(a);imported.run.fish[0].position=[.5,.3,-.2];
 const importedFish=imported.run.fish[0],oldPose=structuredClone(getPreviousFishPose(a.run,a.run.fish[0]));
 assert.equal(imported.run.id,a.run.id);assert.equal(imported.run.activeSeconds,a.run.activeSeconds);
 assert.deepEqual(getPreviousFishPose(imported.run,importedFish),{x:.5,y:.3,z:-.2,heading:importedFish.heading,phase:importedFish.phase,growth:importedFish.growth,atActiveSeconds:imported.run.activeSeconds});
 const importedBefore=structuredClone(imported);resetRunRuntime(a.run);
 assert.deepEqual(imported,importedBefore);
 assert.equal(getPreviousFishPose(imported.run,importedFish).x,.5);
 assert.equal(getPreviousFishPose(a.run,a.run.fish[0]).atActiveSeconds,a.run.activeSeconds);
 assert.ok(oldPose.atActiveSeconds<a.run.activeSeconds);
});

test('scrub mask truncates outside bits, shares public allowance, and renews only on the next tick',()=>{
 const s=createGame(1000,107);s.run.dirt.fill(.8);
 const x=-1.7,z=-.7,mask=getScrubCellMask(0,x,z),before=structuredClone(s);
 for(const invalid of [NaN,Infinity,-1,-Infinity,.25])applyScrubMask(s.run,invalid);
 applyScrubMask(s.run,2**20);assert.deepEqual(s,before);
 for(let i=0;i<4;i++){dispatchAction(s,{type:'scrub',x,z});applyScrubMask(s.run,mask+2**25);}
 for(let i=0;i<20;i++)assert.ok(Math.abs(s.run.dirt[i]-(mask&(1<<i)?.65:.8))<1e-12);
 assert.equal(s.run.wallet,before.run.wallet);assert.equal(s.run.pendingCoins,before.run.pendingCoins);
 assert.equal(s.run.rngState,before.run.rngState);assert.deepEqual(s.run.foodBags,before.run.foodBags);
 collapseMotionInterpolation(s.run);applyScrubMask(s.run,mask);
 for(let i=0;i<20;i++)assert.ok(Math.abs(s.run.dirt[i]-(mask&(1<<i)?.65:.8))<1e-12);
 step(s.run,.05);const afterTick=[...s.run.dirt];
 applyScrubMask(s.run,mask);dispatchAction(s,{type:'scrub',x,z});
 for(let i=0;i<20;i++)assert.ok(Math.abs(s.run.dirt[i]-(afterTick[i]-(mask&(1<<i)?.15:0)))<1e-12);
});

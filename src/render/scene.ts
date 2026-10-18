import { ACESFilmicToneMapping, Color, CylinderGeometry, DoubleSide, Fog, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Plane, PlaneGeometry, Raycaster, RingGeometry, Scene, SphereGeometry, Vector2, Vector3, WebGPURenderer } from 'three/webgpu';
import type { Intersection } from 'three/webgpu';
import type { ActionResult, GameEvent, Mode, Pellet, RunState, SceneFeedback, WaterPointerSample } from '../sim/types.ts';
import { species } from '../data/catalog.ts';
import { waterBounds } from '../data/balance.ts';
import { getScrubCellMask, isInsideWater, WATER_Y, FLOOR_Y, SCRUB_Y, SCRUB_RADIUS } from '../sim/water.ts';
import { getFishAnatomy, getFishAvoidanceBox } from '../data/fish-anatomy.ts';
import { getPreviousFishPose } from '../sim/engine.ts';
import { createBathroom } from './bathroom.ts';
import { createFishModel, disposeFishResources } from './fish-models.ts';
import type { FishModel } from './fish-models.ts';
import { cancelFeedGesture, createFeedGesture, pollFeedGesture, startFeedGesture } from '../input/feed-gesture.ts';

export interface Aquarium {
  backend:string;
  setAnimationLoop:(callback:((timeMs:number)=>void)|null)=>void;
  update:(run:RunState,alpha:number,timeSeconds:number)=>void;
  handleEvents:(events:readonly GameEvent[])=>void;
  setMode:(mode:Mode)=>void;
  cancelInteraction:()=>void;
  setInteractionEnabled:(enabled:boolean)=>void;
  setSelectedFish:(id:string|null)=>void;
  dispose:()=>void;
}
export interface AquariumCallbacks {
  onFeed:(x:number,z:number)=>ActionResult|null;
  onScrub:(sample:WaterPointerSample)=>void;
  onFish:(id:string|null)=>void;
  onFeedback:(feedback:SceneFeedback)=>void;
  onError:(message:string)=>void;
}
interface Animal {model:FishModel;speciesId:string;phase:number;growth:number}
interface Departure {model:FishModel;start:number;position:Vector3;heading:number;phase:number;growth:number}
interface PelletHalo {element:HTMLDivElement;pellet:Pellet;startMs:number}
const GPU_HELP='Không thể mở WebGPU. Hãy dùng Chrome/Edge mới, bật tăng tốc phần cứng và mở game qua localhost hoặc HTTPS. / WebGPU is required. Use current Chrome/Edge with hardware acceleration on localhost or HTTPS.';

export async function createAquarium(container:HTMLElement,callbacks:AquariumCallbacks):Promise<Aquarium> {
  if(!window.isSecureContext||!('gpu' in navigator))throw new Error(GPU_HELP);
  const renderer=new WebGPURenderer({antialias:true,alpha:false});
  try {await renderer.init();} catch(error) {renderer.dispose();throw new Error(`${GPU_HELP}\n${error instanceof Error?error.message:String(error)}`);}
  if(!('isWebGPUBackend' in renderer.backend)||renderer.backend.isWebGPUBackend!==true){renderer.dispose();throw new Error(GPU_HELP);}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;
  const scene=new Scene();scene.background=new Color('#c9e9f5');scene.fog=new Fog('#c9e9f5',18,35);
  const camera=new PerspectiveCamera(36,1,.1,60);camera.position.set(4,9.2,0);camera.lookAt(0,.5,0);camera.updateMatrixWorld();
  const bathroom=createBathroom(scene),animals:Record<string,Animal>={},fishRoot=new Group();scene.add(fishRoot);
  const departures:Departure[]=[];
  let disposed=false,failed=false,enabled=false,mode:Mode='inspect',currentRun:RunState|null=null,bathLevel=0,bounds=waterBounds(0),pointerId:number|null=null,scrubbing=false,clock=0,selectedFishId:string|null=null;
  let pointerOver=false,feedTargetX=0,feedTargetZ=0,feedTargetValid=false,feedbackUntilMs=0;
  const gesture=createFeedGesture(),feedback:SceneFeedback={hoveredFishId:null,target:'none',feeding:false,dropped:0};
  let publishedFeedback:SceneFeedback={...feedback};
  const halos:PelletHalo[]=[],haloPosition=new Vector3();
  const canvas=renderer.domElement;canvas.setAttribute('aria-label','Bồn cá 3D / 3D bathtub aquarium');canvas.style.display='block';canvas.style.width='100%';canvas.style.height='100%';canvas.style.touchAction='none';container.append(canvas);
  const reticle=document.createElement('div');reticle.className='feed-reticle';reticle.setAttribute('aria-hidden','true');reticle.style.pointerEvents='none';reticle.hidden=true;container.append(reticle);
  const fail=(message:string)=>{if(failed||disposed)return;failed=true;enabled=false;cancelInteraction();void renderer.setAnimationLoop(null);callbacks.onError(message);};
  renderer.onDeviceLost=info=>fail(`WebGPU đã dừng / WebGPU device lost: ${info.message}`);renderer.onError=message=>fail(`Lỗi đồ họa / Graphics error: ${message}`);
  const resize=()=>{
    if(disposed)return;const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.zoom=1;camera.updateProjectionMatrix();
    let maxAbsX=0,maxAbsY=0;const p=new Vector3(),sx=bounds.x/2.2,sz=bounds.z;
    // Fit the tub itself, not the surrounding floor or the empty space above the faucet.
    for(const x of [-2.48*sx,2.48*sx])for(const y of [-.60,1.40])for(const z of [-1.28*sz,1.28*sz]){p.set(x,y,z).project(camera);maxAbsX=Math.max(maxAbsX,Math.abs(p.x));maxAbsY=Math.max(maxAbsY,Math.abs(p.y));}
    camera.zoom=Math.min(Math.max(.001,1-32/width)/Math.max(1e-8,maxAbsX),Math.max(.001,1-40/height)/Math.max(1e-8,maxAbsY));camera.updateProjectionMatrix();
  };
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  const pelletGeometry=new SphereGeometry(.025,7,5),pelletMaterial=new MeshStandardMaterial({color:0xa26f3d,roughness:.9});
  let pelletCapacity=64,pellets=new InstancedMesh(pelletGeometry,pelletMaterial,pelletCapacity);pellets.count=0;pellets.frustumCulled=false;scene.add(pellets);
  const coinGeometry=new CylinderGeometry(.055,.055,.014,12),coinMaterial=new MeshStandardMaterial({color:0xe8be57,metalness:.55,roughness:.25}),coins=new InstancedMesh(coinGeometry,coinMaterial,80);coins.count=0;coins.frustumCulled=false;scene.add(coins);
  const transform=new Matrix4(),raycaster=new Raycaster(),pointer=new Vector2(),waterPlane=new Plane(new Vector3(0,1,0),-WATER_Y),bottomPlane=new Plane(new Vector3(0,1,0),-SCRUB_Y),hit=new Vector3();
  const ringGeometry=new RingGeometry(.965,1,64);ringGeometry.rotateX(-Math.PI/2);
  const footprintGeometry=new RingGeometry(.90,1,64);footprintGeometry.rotateX(-Math.PI/2);
  const selectedMaterial=new MeshBasicMaterial({color:0x16c3a0,transparent:true,opacity:.85,depthWrite:false,side:DoubleSide});
  const hoveredMaterial=new MeshBasicMaterial({color:0x59c7ef,transparent:true,opacity:.75,depthWrite:false,side:DoubleSide});
  const selectedRing=new Mesh(footprintGeometry,selectedMaterial),hoveredRing=new Mesh(footprintGeometry,hoveredMaterial);
  const brushMaterial=new MeshBasicMaterial({color:0x16c3a0,transparent:true,opacity:.85,depthWrite:false,side:DoubleSide});
  const brushRing=new Mesh(ringGeometry,brushMaterial);brushRing.scale.set(SCRUB_RADIUS,1,SCRUB_RADIUS);brushRing.position.y=SCRUB_Y;
  const cellGeometry=new PlaneGeometry(1,1);cellGeometry.rotateX(-Math.PI/2);
  const cellBorderGeometry=new RingGeometry(.965,1,4);cellBorderGeometry.rotateZ(Math.PI/4);cellBorderGeometry.rotateX(-Math.PI/2);
  const cellMaterial=new MeshBasicMaterial({transparent:true,opacity:.16,depthWrite:false,side:DoubleSide});
  const cellBorderMaterial=new MeshBasicMaterial({transparent:true,opacity:.65,depthWrite:false,side:DoubleSide});
  const brushCells=new InstancedMesh(cellGeometry,cellMaterial,20),brushBorders=new InstancedMesh(cellBorderGeometry,cellBorderMaterial,20);
  for(const object of [selectedRing,hoveredRing,brushRing,brushCells,brushBorders]){object.visible=false;object.frustumCulled=false;scene.add(object);}
  let brushValid=false,brushX=0,brushZ=0,lastHoverAtMs=-Infinity;
  const pickHits:Intersection[]=[],projected=new Vector3(),previewColor=new Color();
  function syncHighlights():void {
    for(const id of Object.keys(animals))animals[id].model.setHighlight(!enabled?'none':id===selectedFishId?'selected':mode==='inspect'&&id===feedback.hoveredFishId?'hovered':'none');
  }
  function pickFish():string|null {
    scene.updateMatrixWorld(true);
    for(const animal of Object.values(animals))animal.model.mesh.skeleton.update();
    raycaster.setFromCamera(pointer,camera);pickHits.length=0;raycaster.intersectObjects(fishRoot.children,true,pickHits);
    for(const intersection of pickHits){let object=intersection.object;while(object.parent&&object.parent!==fishRoot)object=object.parent;const id:unknown=object.userData.fishId;if(typeof id==='string'&&animals[id])return id;}
    let best:string|null=null,bestPixels=64,bestDepth=Infinity;
    for(const id of Object.keys(animals)){
      const position=animals[id].model.root.position;projected.copy(position).project(camera);if(projected.z< -1||projected.z>1)continue;
      const dx=(projected.x-pointer.x)*canvas.clientWidth*.5,dy=(projected.y-pointer.y)*canvas.clientHeight*.5,d2=dx*dx+dy*dy;
      const depth=(position.x-raycaster.ray.origin.x)*raycaster.ray.direction.x+(position.y-raycaster.ray.origin.y)*raycaster.ray.direction.y+(position.z-raycaster.ray.origin.z)*raycaster.ray.direction.z;
      if(d2<=64&&(best===null||d2<bestPixels||d2===bestPixels&&(depth<bestDepth||depth===bestDepth&&id<best))){best=id;bestPixels=d2;bestDepth=depth;}
    }
    return best;
  }
  function placeFishRing(ring:Mesh,id:string|null):void {
    const animal=id?animals[id]:undefined;ring.visible=enabled&&!!animal;if(!animal)return;
    const spec=species(animal.speciesId),box=getFishAvoidanceBox(spec),scale=animal.model.root.scale.x,p=animal.model.root.position;
    ring.position.set(p.x,Math.max(FLOOR_Y+.045,p.y-getFishAnatomy(spec).lower*scale-.025),p.z);
    ring.rotation.y=animal.model.root.rotation.y;ring.scale.set(Math.max(.09,(box.max[0]-box.min[0])*scale*.5),1,Math.max(.11,(box.max[2]-box.min[2])*scale*.5));
  }
  function updateBrush():void {
    if(enabled&&mode==='scrub'&&pointerOver){
      raycaster.setFromCamera(pointer,camera);brushValid=!!raycaster.ray.intersectPlane(bottomPlane,hit)&&inside(hit.x,hit.z);if(brushValid){brushX=hit.x;brushZ=hit.z;}
    }
    const visible=enabled&&mode==='scrub'&&pointerOver&&brushValid;brushRing.visible=brushCells.visible=brushBorders.visible=visible;if(!visible)return;
    brushRing.position.set(brushX,SCRUB_Y,brushZ);const mask=getScrubCellMask(bathLevel,brushX,brushZ);let count=0;
    for(let i=0;i<20;i++)if(mask&(1<<i)){
      const dirt=currentRun?.dirt[i]??0,x=-bounds.x+(i%5+.5)*2*bounds.x/5,z=-bounds.z+(Math.floor(i/5)+.5)*2*bounds.z/4,w=2*bounds.x/5,h=2*bounds.z/4;
      transform.makeScale(w,1,h);transform.setPosition(x,SCRUB_Y+.001,z);brushCells.setMatrixAt(count,transform);
      previewColor.set(dirt>.02?0xc4a36c:0xcbded4);brushCells.setColorAt(count,previewColor);
      transform.makeScale(w/Math.SQRT2,1,h/Math.SQRT2);transform.setPosition(x,SCRUB_Y+.002,z);brushBorders.setMatrixAt(count,transform);brushBorders.setColorAt(count,previewColor);count++;
    }
    brushCells.count=brushBorders.count=count;brushCells.instanceMatrix.needsUpdate=true;brushBorders.instanceMatrix.needsUpdate=true;
    if(brushCells.instanceColor)brushCells.instanceColor.needsUpdate=true;if(brushBorders.instanceColor)brushBorders.instanceColor.needsUpdate=true;
  }
  const inside=(x:number,z:number)=>isInsideWater(bathLevel,x,z);
  const hasFood=()=>{
    const run=currentRun;
    return run!==null&&run.foodBags.some(bag=>bag.remaining>0&&bag.expiresAtActiveSeconds>run.activeSeconds);
  };
  function publishFeedback():void {
    reticle.hidden=!enabled||mode!=='feed'||!pointerOver||feedback.target==='none';
    reticle.dataset.target=feedback.target;
    if(feedback.target===publishedFeedback.target&&feedback.feeding===publishedFeedback.feeding&&feedback.dropped===publishedFeedback.dropped&&feedback.hoveredFishId===publishedFeedback.hoveredFishId)return;
    publishedFeedback={...feedback};callbacks.onFeedback(publishedFeedback);
  }
  function clearHalos():void {for(const halo of halos)halo.element.remove();halos.length=0;}
  function stopInteraction(phase:'end'|'cancel'):void {
    const wasFeeding=gesture.pointerId!==null;
    cancelFeedGesture(gesture);
    if(scrubbing){scrubbing=false;callbacks.onScrub({phase});}
    if(pointerId!==null&&canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);
    feedback.feeding=false;
    if(wasFeeding)feedbackUntilMs=performance.now()+1500;
    publishFeedback();
  }
  function cancelInteraction():void {
    pointerOver=false;feedTargetValid=false;brushValid=false;feedback.target='none';feedback.hoveredFishId=null;stopInteraction('cancel');clearHalos();syncHighlights();updateBrush();hoveredRing.visible=false;selectedRing.visible=false;
  }
  const ray=(event:PointerEvent)=>{
    const rect=canvas.getBoundingClientRect();
    pointerOver=rect.width>0&&rect.height>0&&event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
    reticle.style.left=`${event.clientX-rect.left}px`;reticle.style.top=`${event.clientY-rect.top}px`;
    if(rect.width<=0||rect.height<=0)return false;
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);return true;
  };
  const feedTarget=(event:PointerEvent)=>{
    const intersects=ray(event)&&!!raycaster.ray.intersectPlane(waterPlane,hit);
    feedTargetValid=intersects&&pointerOver&&inside(hit.x,hit.z);
    if(intersects){feedTargetX=hit.x;feedTargetZ=hit.z;}
    feedback.target=feedTargetValid?(hasFood()?'valid':'no-food'):'outside-water';
    publishFeedback();return intersects;
  };
  const dropFood=(nowMs:number):boolean=>{
    const result=callbacks.onFeed(feedTargetX,feedTargetZ);
    if(!result?.ok){
      stopInteraction('cancel');
      feedback.target=result&&!result.ok&&result.code==='no-food'?'no-food':result&&!result.ok&&result.code==='outside-water'?'outside-water':feedback.target;
      publishFeedback();return false;
    }
    feedback.dropped++;bathroom.ripple(feedTargetX,feedTargetZ,nowMs/1000);
    const pellet=currentRun?.pellets.at(-1);
    if(pellet){
      const element=document.createElement('div');element.className='feed-pellet-halo';element.setAttribute('aria-hidden','true');element.style.pointerEvents='none';element.hidden=true;container.append(element);
      halos.push({element,pellet,startMs:nowMs});
    }
    return true;
  };
  const scrubTarget=(event:PointerEvent):boolean=>{
    brushValid=ray(event)&&pointerOver&&!!raycaster.ray.intersectPlane(bottomPlane,hit)&&inside(hit.x,hit.z);
    if(brushValid){brushX=hit.x;brushZ=hit.z;}
    feedback.target=brushValid?'valid':'outside-water';publishFeedback();updateBrush();return brushValid;
  };
  const scrub=(event:PointerEvent,phase:'start'|'move')=>{
    if(!scrubTarget(event)){stopInteraction('cancel');return;}
    if(phase==='start')scrubbing=true;
    callbacks.onScrub({phase,x:brushX,z:brushZ});
  };
  const down=(event:PointerEvent)=>{
    if(failed||disposed||!enabled||!event.isPrimary||event.button!==0||pointerId!==null)return;
    event.preventDefault();pointerId=event.pointerId;
    try {
      if(mode==='scrub'){
        scrub(event,'start');if(scrubbing)canvas.setPointerCapture(event.pointerId);return;
      }
      if(mode==='feed'){
        feedback.dropped=0;feedbackUntilMs=performance.now()+1500;
        if(!feedTarget(event)){stopInteraction('cancel');return;}
        if(!feedTargetValid){callbacks.onFeed(feedTargetX,feedTargetZ);stopInteraction('cancel');return;}
        const nowMs=performance.now();
        if(dropFood(nowMs)&&enabled&&!failed&&!disposed){
          startFeedGesture(gesture,event.pointerId,nowMs);feedback.feeding=true;feedbackUntilMs=0;canvas.setPointerCapture(event.pointerId);publishFeedback();
        }
        else {feedbackUntilMs=nowMs+1500;publishFeedback();}
        return;
      }
      if(!ray(event))return;
      callbacks.onFish(pickFish());
    }catch(error){fail(error instanceof Error?error.message:String(error));}
  };
  const move=(event:PointerEvent)=>{
    if(failed||disposed||!enabled||!event.isPrimary||(pointerId!==null&&pointerId!==event.pointerId))return;
    try {
      if(mode==='feed'){
        feedTarget(event);
        if(gesture.pointerId===event.pointerId&&(!feedTargetValid||(event.buttons&1)===0))stopInteraction('cancel');
      }else if(mode==='scrub'){
        if(scrubbing&&event.pointerId===pointerId){if((event.buttons&1)===0)stopInteraction('cancel');else scrub(event,'move');}
        else scrubTarget(event);
      }else {ray(event);}
    }catch(error){fail(error instanceof Error?error.message:String(error));}
  };
  const up=(event:PointerEvent)=>{if(event.pointerId!==pointerId)return;stopInteraction(event.type==='pointerup'?'end':'cancel');pointerId=null;};
  const lostCapture=(event:PointerEvent)=>{if(event.pointerId===pointerId)stopInteraction('cancel');};
  const leave=(event:PointerEvent)=>{if(!event.isPrimary||(pointerId!==null&&pointerId!==event.pointerId))return;pointerOver=false;feedTargetValid=false;brushValid=false;feedback.hoveredFishId=null;feedback.target='outside-water';stopInteraction('cancel');syncHighlights();updateBrush();hoveredRing.visible=false;};
  const blur=()=>{cancelInteraction();pointerId=null;};
  const visibility=()=>{if(document.hidden)blur();};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')cancelInteraction();};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('lostpointercapture',lostCapture);
  window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',blur);window.addEventListener('pagehide',blur);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);
  return {backend:'WebGPU',setAnimationLoop(callback){
    if(disposed||failed)return;
    void renderer.setAnimationLoop(callback?time=>{if(disposed||failed)return;try{callback(time);}catch(error){fail(error instanceof Error?error.message:String(error));}}:null).catch(error=>fail(error instanceof Error?error.message:String(error)));
  },handleEvents(events){
    for(const event of events){
      if(event.type!=='fish-left')continue;
      const animal=animals[event.fishId];if(!animal)continue;
      animal.model.setHighlight('none');
      departures.push({model:animal.model,start:clock,position:animal.model.root.position.clone(),heading:animal.model.root.rotation.y,phase:animal.phase,growth:animal.growth});
      delete animal.model.root.userData.fishId;delete animals[event.fishId];
    }
  },cancelInteraction,setInteractionEnabled(next){
    enabled=next&&!failed&&!disposed;if(!enabled)cancelInteraction();else {syncHighlights();publishFeedback();}
  },setSelectedFish(id){
    if(id===selectedFishId)return;selectedFishId=id;syncHighlights();
  },setMode(next){
    cancelInteraction();mode=next;canvas.style.cursor=next==='scrub'?'crosshair':next==='feed'?'none':'pointer';publishFeedback();
  },update(run,alpha,timeSeconds){
    if(disposed||failed)return;
    try {
    if(run!==currentRun){
      cancelInteraction();feedback.dropped=0;feedbackUntilMs=0;
      for(const id of Object.keys(animals)){animals[id].model.dispose();delete animals[id];}
      for(const departure of departures)departure.model.dispose();departures.length=0;currentRun=run;
    }
    const nowMs=performance.now();
    if(enabled&&mode==='feed'&&pointerId!==null&&gesture.pointerId===pointerId&&feedTargetValid&&pollFeedGesture(gesture,nowMs))dropFood(nowMs);
    if(!feedback.feeding&&feedbackUntilMs>0&&nowMs>=feedbackUntilMs){feedback.dropped=0;feedbackUntilMs=0;}
    clock=timeSeconds;bounds=waterBounds(run.bathLevel);if(bathLevel!==run.bathLevel){bathLevel=run.bathLevel;resize();}
    if(feedTargetValid&&!inside(feedTargetX,feedTargetZ)){feedTargetValid=false;feedback.target='outside-water';stopInteraction('cancel');}
    else if(enabled&&mode==='feed'&&pointerOver&&feedTargetValid)feedback.target=hasFood()?'valid':'no-food';
    publishFeedback();
    for(const fish of run.fish){
      let animal:Animal|undefined=animals[fish.id];
      if(animal&&animal.speciesId!==fish.speciesId){animal.model.dispose();delete animals[fish.id];animal=undefined;}
      if(!animal){const model=createFishModel(species(fish.speciesId));animal={model,speciesId:fish.speciesId,phase:fish.phase,growth:fish.growth};animals[fish.id]=animal;model.root.userData.fishId=fish.id;model.setHighlight(enabled&&fish.id===selectedFishId?'selected':'none');fishRoot.add(model.root);}
      const previous=getPreviousFishPose(run,fish),t=Math.max(0,Math.min(1,alpha)),dt=run.activeSeconds-previous.atActiveSeconds;
      const headingDelta=Math.atan2(Math.sin(fish.heading-previous.heading),Math.cos(fish.heading-previous.heading));
      const dx=fish.position[0]-previous.x,dy=fish.position[1]-previous.y,dz=fish.position[2]-previous.z;
      animal.model.root.position.set(previous.x+dx*t,previous.y+dy*t,previous.z+dz*t);
      animal.phase=previous.phase+(fish.phase-previous.phase)*t;animal.growth=previous.growth+(fish.growth-previous.growth)*t;
      animal.model.root.rotation.y=previous.heading+headingDelta*t;
      animal.model.animate(animal.phase,dt>0?headingDelta/dt:0,animal.growth,dt>0?Math.hypot(dx,dz)/dt:0,dt>0?dy/dt:0);
    }
    // Transactions can remove or add fish without advancing activeSeconds.
    for(const id of Object.keys(animals))if(!run.fish.some(fish=>fish.id===id)){animals[id].model.dispose();delete animals[id];}
    for(let i=departures.length-1;i>=0;i--){
      const departure=departures[i],t=Math.max(0,(timeSeconds-departure.start)/1.25);
      if(t>=1){departure.model.dispose();departures.splice(i,1);continue;}
      const from=departure.position,viaX=bounds.x*.8,viaZ=-bounds.z,exitX=bounds.x+3,exitZ=-bounds.z-2,u=1-t;
      const model=departure.model,vx=2*(u*(viaX-from.x)+t*(exitX-viaX))/1.25,vy=2*(u*(1.5-from.y)+t*.3)/1.25,vz=2*(u*(viaZ-from.z)+t*(exitZ-viaZ))/1.25;
      model.root.position.set(u*u*from.x+2*u*t*viaX+t*t*exitX,u*u*from.y+2*u*t*1.5+t*t*1.8,u*u*from.z+2*u*t*viaZ+t*t*exitZ);
      const heading=Math.atan2(vx,vz),ax=2*(exitX-2*viaX+from.x)/(1.25*1.25),az=2*(exitZ-2*viaZ+from.z)/(1.25*1.25);
      model.root.rotation.y=departure.heading+Math.atan2(Math.sin(heading-departure.heading),Math.cos(heading-departure.heading))*Math.min(1,t*5);
      model.animate(departure.phase+(timeSeconds-departure.start)*Math.PI*2*1.1,(vz*ax-vx*az)/Math.max(.001,vx*vx+vz*vz),departure.growth,Math.hypot(vx,vz),vy);
    }
    if(run.pellets.length>pelletCapacity){scene.remove(pellets);pellets.dispose();pelletCapacity=Math.max(run.pellets.length,pelletCapacity*2);pellets=new InstancedMesh(pelletGeometry,pelletMaterial,pelletCapacity);pellets.frustumCulled=false;scene.add(pellets);}
    pellets.count=run.pellets.length;
    for(let i=0;i<run.pellets.length;i++){const pellet=run.pellets[i];transform.makeTranslation(...pellet.position);pellets.setMatrixAt(i,transform);}
    for(let i=halos.length-1;i>=0;i--){
      const halo=halos[i],ageMs=nowMs-halo.startMs;
      if(ageMs>=800||!run.pellets.includes(halo.pellet)){halo.element.remove();halos.splice(i,1);continue;}
      haloPosition.set(...halo.pellet.position).project(camera);
      halo.element.hidden=haloPosition.z< -1||haloPosition.z>1||Math.abs(haloPosition.x)>1||Math.abs(haloPosition.y)>1;
      halo.element.style.left=`${(haloPosition.x+1)*.5*canvas.clientWidth}px`;halo.element.style.top=`${(1-haloPosition.y)*.5*canvas.clientHeight}px`;halo.element.style.opacity=String(1-ageMs/800);
    }
    pellets.instanceMatrix.needsUpdate=true;
    coins.count=Math.min(80,run.pendingCoins);
    for(let i=0;i<coins.count;i++){const hash=(Math.imul(i+1,2654435761)>>>0)/4294967296,x=(hash*2-1)*bounds.x*.8,z=((((i+1)*.61803398875)%1)*2-1)*bounds.z*.75;transform.makeRotationX(Math.PI/2);transform.setPosition(x,.83+Math.sin(timeSeconds*1.9+i*2)*.035,z);coins.setMatrixAt(i,transform);}coins.instanceMatrix.needsUpdate=true;
    bathroom.update(run,timeSeconds);scene.updateMatrixWorld(true);
    if(enabled&&mode==='inspect'&&pointerOver&&nowMs-lastHoverAtMs>=1000/30){
      lastHoverAtMs=nowMs;const id=pickFish();if(id!==feedback.hoveredFishId){feedback.hoveredFishId=id;syncHighlights();publishFeedback();}
    }
    placeFishRing(selectedRing,selectedFishId);placeFishRing(hoveredRing,mode==='inspect'&&feedback.hoveredFishId!==selectedFishId?feedback.hoveredFishId:null);updateBrush();
    renderer.render(scene,camera);
    }catch(error){fail(error instanceof Error?error.message:String(error));}
  },dispose(){
    if(disposed)return;enabled=false;cancelInteraction();disposed=true;pointerId=null;void renderer.setAnimationLoop(null);observer.disconnect();
    canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('lostpointercapture',lostCapture);
    window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',blur);window.removeEventListener('pagehide',blur);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);
    brushCells.dispose();brushBorders.dispose();ringGeometry.dispose();footprintGeometry.dispose();cellGeometry.dispose();cellBorderGeometry.dispose();
    for(const material of [selectedMaterial,hoveredMaterial,brushMaterial,cellMaterial,cellBorderMaterial])material.dispose();
    for(const id of Object.keys(animals))animals[id].model.dispose();for(const departure of departures)departure.model.dispose();disposeFishResources();bathroom.dispose();pellets.dispose();coins.dispose();pelletGeometry.dispose();pelletMaterial.dispose();coinGeometry.dispose();coinMaterial.dispose();renderer.dispose();canvas.remove();reticle.remove();
  }};
}

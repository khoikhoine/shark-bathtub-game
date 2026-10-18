import { Bone, BufferGeometry, Color, DoubleSide, FrontSide, Group, MeshStandardMaterial, Skeleton, SkinnedMesh, Vector2, Vector3 } from 'three/webgpu';
import type { SpeciesSpec } from '../sim/types.ts';
import { getFishAnatomy, getFishAvoidanceBox, getFishModelScale } from '../data/fish-anatomy.ts';
import { MOTION, MOTION_OVERRIDES } from '../data/balance.ts';
import { buildSurfaceNets, ell, union } from './surface-nets.ts';
import type { Point3 } from './surface-nets.ts';
import { clamp, curve, FishGeometry, lerpPoint, mix, monotone, WHITE_UV } from './fish-geometry.ts';
import type { Influence, SkinWeights, SurfaceSample, SurfaceSampler, SweepStation } from './fish-geometry.ts';
import { disposeFishTextures, getFishTextures } from './fish-textures.ts';

export interface FishModel {
  root:Group; mesh:SkinnedMesh; bones:Bone[];
  animate(phase:number,turnRate:number,growth:number,speed:number,verticalSpeed:number):void;
  setHighlight(state:'none'|'hovered'|'selected'):void;
  dispose():void;
}
interface Joint { name:string; position:Point3; kind:'body'|'pectoral'|'wing'|'distal'|'dorsal'|'anal'; side:number; t:number }
interface ModelData { geometry:BufferGeometry; finGeometry:BufferGeometry; eyeGeometry:BufferGeometry; material:MeshStandardMaterial; finMaterial:MeshStandardMaterial; eyeMaterial:MeshStandardMaterial; joints:Joint[] }
const cache:Record<string,ModelData>={};
const HEAD:readonly [number,number,number]=[0,0,0];
const WHITE=new Color(0xffffff),DARK=new Color('#24373b'),PUPIL=new Color('#101c21');
const STATIONS=[0,.10,.24,.45,.65,.82,1] as const;
const WIDTH=[.12,.60,1,.96,.72,.38,.08] as const;
const UPPER=[.10,.62,1,.95,.70,.35,.08] as const;
const LOWER=[.12,.55,.92,1,.82,.40,.08] as const;
const HEAD_FORM_BY_FAMILY:Readonly<Record<string,readonly [number,number,number]>>={
  livebearer:[.10,.10,.13],goldfish:[.18,.16,.22],minnow:[.08,.08,.10],flowing:[.12,.12,.14],tall:[.09,.12,.12],
  reef:[.14,.14,.16],gourami:[.14,.15,.18],puffer:[.30,.28,.33],lionfish:[.24,.22,.26],shark:[.16,.16,.18],
};
function headForm(spec:SpeciesSpec):readonly [number,number,number] {
  if(['platy','molly','clownfish','blue-cichlid'].includes(spec.id))return [.22,.18,.22];
  if(spec.id==='whale-shark')return [.70,.35,.35];
  if(spec.id==='nurse-shark')return [.55,.35,.30];
  return HEAD_FORM_BY_FAMILY[spec.family];
}
type TailShape='delta'|'round'|'fork'|'square'|'halfmoon'|'split'|'sword';
/** Every ordinary species has an explicit silhouette, not a generic fallback fish. */
const FIN_FORMS:Readonly<Record<string,{tail:TailShape;height:number;dorsal:number;anal:number}>>={
  guppy:{tail:'delta',height:.23,dorsal:.17,anal:.105},goldfish:{tail:'split',height:.21,dorsal:.22,anal:.19},
  'neon-tetra':{tail:'fork',height:.085,dorsal:.105,anal:.09},'zebra-danio':{tail:'fork',height:.085,dorsal:.09,anal:.08},
  platy:{tail:'round',height:.115,dorsal:.18,anal:.14},molly:{tail:'round',height:.135,dorsal:.21,anal:.15},
  swordtail:{tail:'sword',height:.115,dorsal:.15,anal:.13},'white-cloud':{tail:'fork',height:.085,dorsal:.11,anal:.085},
  betta:{tail:'halfmoon',height:.30,dorsal:.27,anal:.29},angelfish:{tail:'delta',height:.13,dorsal:.42,anal:.40},
  discus:{tail:'round',height:.105,dorsal:.255,anal:.255},koi:{tail:'fork',height:.14,dorsal:.18,anal:.15},
  clownfish:{tail:'round',height:.13,dorsal:.19,anal:.18},'blue-tang':{tail:'delta',height:.16,dorsal:.245,anal:.24},
  'yellow-tang':{tail:'delta',height:.15,dorsal:.27,anal:.27},'royal-gramma':{tail:'round',height:.115,dorsal:.16,anal:.14},
  mandarin:{tail:'round',height:.12,dorsal:.19,anal:.12},copperband:{tail:'delta',height:.13,dorsal:.25,anal:.25},
  'moorish-idol':{tail:'delta',height:.14,dorsal:.30,anal:.30},'emperor-angelfish':{tail:'square',height:.14,dorsal:.24,anal:.24},
  'blue-gourami':{tail:'round',height:.135,dorsal:.22,anal:.235},'blue-cichlid':{tail:'square',height:.15,dorsal:.24,anal:.21},
  'dwarf-gourami':{tail:'round',height:.125,dorsal:.235,anal:.245},rainbowfish:{tail:'fork',height:.14,dorsal:.23,anal:.20},
  puffer:{tail:'round',height:.10,dorsal:.18,anal:.18},lionfish:{tail:'round',height:.14,dorsal:.21,anal:.18},
};

function hammerField(x:number,y:number,z:number):number {
  let body=ell(x,y,z+.2,.48,.42,1.27);
  body=union(body,ell(x,y+.015,z+1.42,.22,.22,.75),.13);
  let head=ell(x,y-.015,z-1.11+.14*x*x,1.31,.245,.45);
  head=Math.max(head,-ell(x,y,z-1.6,.19,.39,.14));
  body=union(body,head,.16);
  return Math.max(body,-ell(x,y+.24,z-1.39,.56,.145,.27));
}
function modelHammerField(x:number,y:number,z:number):number {return hammerField(x*4.7,y*4.7,z*4.7-.45)/4.7;}

function buildCenterline(spec:SpeciesSpec):Point3[] {
  const a=getFishAnatomy(spec),points:Point3[]=[];
  if(spec.family==='seahorse'){
    for(let i=0;i<=28;i++){
      const t=i/28;points.push([0,.32-.56*t,.045+.075*Math.sin(t*Math.PI*2)]);
    }
    for(let i=1;i<=20;i++){
      const angle=i/20*Math.PI*1.85,radius=.085*(1-i/25);points.push([0,-.24+Math.sin(angle)*radius,-.04+Math.cos(angle)*radius]);
    }
  }else{
    const head=spec.id==='sawfish'?.32:a.headZ;
    for(let i=0;i<=48;i++){
      const t=i/48,z=mix(head,spec.family==='eel'?a.tailZ:a.peduncleZ,t);
      points.push([0,spec.family==='eel'?.018*Math.sin(t*Math.PI*1.5):0,z]);
    }
  }
  // Redistribute samples by arc length; joint locations and skin weights use this same path.
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1],points[i][2]-points[i-1][2]));
  const result:Point3[]=[],length=distances[distances.length-1];let cursor=0;
  for(let i=0;i<points.length;i++){
    const distance=length*i/(points.length-1);while(cursor<points.length-2&&distances[cursor+1]<distance)cursor++;
    result.push(lerpPoint(points[cursor],points[cursor+1],(distance-distances[cursor])/(distances[cursor+1]-distances[cursor])));
  }
  return result;
}
function buildJoints(spec:SpeciesSpec,centerline:Point3[]):Joint[] {
  const a=getFishAnatomy(spec),ray=spec.family==='ray',sea=spec.family==='seahorse',sun=spec.id==='sunfish';
  const count=ray?3:sea?7:sun?5:spec.family==='eel'?11:7;
  const joints:Joint[]=[{name:'head',position:[0,0,0],kind:'body',side:0,t:0}];
  for(let i=1;i<count;i++){
    const t=i/(count-1),position=sea||spec.family==='eel'?curve(centerline,t):[0,0,mix(a.headZ*.55,a.peduncleZ,t)] as Point3;
    joints.push({name:`body-${i}`,position,kind:'body',side:0,t});
  }
  if(ray){
    for(const side of [-1,1])for(let i=1;i<=3;i++)joints.push({name:`wing-${side}-${i}`,position:[side*a.halfWidth*i/3,0,-.06],kind:'wing',side,t:i/3});
  }else if(sea)joints.push({name:'dorsal',position:[0,.10,-.04],kind:'dorsal',side:0,t:1});
  else if(sun){joints.push({name:'dorsal',position:[0,.19,-.07],kind:'dorsal',side:0,t:1},{name:'anal',position:[0,-.19,-.07],kind:'anal',side:0,t:1});}
  else if(spec.family!=='eel'){
    for(const side of [-1,1])joints.push({name:`pectoral-${side}`,position:[side*a.halfWidth*.7,-.025,a.headZ*.32],kind:'pectoral',side,t:1});
    if(spec.id==='betta'||spec.id==='lionfish')for(const side of [-1,1])joints.push({name:`distal-${side}`,position:spec.id==='betta'?[0,side*.16,a.peduncleZ-.12]:[side*.23,-.055,-.04],kind:'distal',side,t:1});
    if(spec.id==='thresher-shark')joints.push({name:'upper-tail-1',position:[0,.16,-.62],kind:'distal',side:1,t:.5},{name:'upper-tail-2',position:[0,.30,-.85],kind:'distal',side:1,t:1});
  }
  return joints;
}
function bodyInfluence(t:number,count:number):readonly [number,number,number] {
  if(t<=.22)return HEAD;
  const s=clamp((t-.22)/.78)*(count-1),a=Math.floor(s);return [a,Math.min(count-1,a+1),s-a];
}

function blendRoot(skin:SkinWeights|undefined,joint?:number,distal=0):SkinWeights {
  if(!skin)throw new Error('Missing attachment skin');
  if(joint===undefined||distal===0)return skin;
  const amount=distal*distal,merged=new Map<number,number>();
  for(let i=0;i<4;i++)merged.set(skin.indices[i],(merged.get(skin.indices[i])??0)+skin.weights[i]*(1-amount));
  merged.set(joint,(merged.get(joint)??0)+amount);
  const entries=[...merged].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,4),sum=entries.reduce((n,e)=>n+e[1],0);
  const indices:[number,number,number,number]=[0,0,0,0],weights:[number,number,number,number]=[0,0,0,0];
  entries.forEach(([index,weight],i)=>{indices[i]=index;weights[i]=weight/sum;});return {indices,weights};
}
const sampledRoot=(_span:number,_distal:number,_root:Readonly<Point3>,skin?:SkinWeights):Influence=>blendRoot(skin);
function surface(sampler:SurfaceSampler,axis:0|1|2,side:number,region:string) {
  return {sampler,axis,side:side as -1|1,region};
}
function project(sampler:SurfaceSampler,at:Readonly<Point3>,axis:0|1|2,side:number,region:string,offset=.0005,clampSection=true):SurfaceSample {
  const out:SurfaceSample={point:[0,0,0],normal:[0,0,0],skin:{indices:[0,0,0,0],weights:[0,0,0,0]}};
  if(axis===0&&clampSection){
    const section:Point3=[0,at[1],at[2]];
    if(!sampler.sample(out,section,1,-1))throw new Error(`missing ${region} surface`);
    const low=out.point[1];
    if(!sampler.sample(out,section,1,1))throw new Error(`missing ${region} surface`);
    const high=out.point[1];at=[at[0],clamp(at[1],low+.1*(high-low),high-.1*(high-low)),at[2]];
  }
  if(!sampler.sample(out,at,axis,side as -1|1))throw new Error(`missing ${region} surface`);
  for(let i=0;i<3;i++)out.point[i]+=out.normal[i]*offset;
  return out;
}

function buildSweep(spec:SpeciesSpec,body:FishGeometry,centerline:Point3[],bodyCount:number):void {
  const a=getFishAnatomy(spec),sea=spec.family==='seahorse',eel=spec.family==='eel',id=spec.id,stations:SweepStation[]=[];
  const rings=sea?49:32;
  const width=[...WIDTH] as number[],upper=[...UPPER] as number[],lower=[...LOWER] as number[];
  if(!sea&&!eel){
    const form=headForm(spec);width[0]=form[0];upper[0]=form[1];lower[0]=form[2];
    if(a.mouth[2]===a.headZ){upper[0]=clamp(Math.max(upper[0],(a.mouth[1]+.007)/a.upper));lower[0]=clamp(Math.max(lower[0],(-a.mouth[1]+.007)/a.lower));}
  }
  let stationT:readonly number[]=STATIONS;
  if(spec.family==='tall'||['blue-tang','yellow-tang','copperband','emperor-angelfish'].includes(id)){
    stationT=[0,.10,.28,.45,.65,.82,1];width[2]=.90;width[3]=1;upper[2]=.87;upper[3]=1;lower[2]=.87;lower[3]=1;
  }else if(spec.family==='minnow'){stationT=[0,.10,.32,.49,.66,.82,1];}
  if(id==='goldfish'){lower[2]=.86;lower[3]=1;stationT=[0,.10,.24,.50,.68,.84,1];}
  if(id==='sunfish'){width[5]=.80;width[6]=.64;upper[5]=.84;upper[6]=.63;lower[5]=.84;lower[6]=.63;}
  const mouthT=(centerline[0][2]-a.mouth[2])/(centerline[0][2]-a.peduncleZ),mouthFlatten=id==='sawfish'?.55+.45*mouthT:1;
  const mouthBump=id==='nurse-shark'||id==='sawfish'?Math.max(0,-a.mouth[1]-a.lower*monotone(mouthT,stationT,lower)*mouthFlatten):0;
  for(let i=0;i<rings;i++){
    const t=i/(rings-1),point=curve(centerline,t);
    if(sea){
      const trunk=t<.58,shape=trunk?Math.sin(Math.PI*clamp(t/.72)):.27*(1-(t-.58)/.46);
      stations.push({point,width:.003+.054*Math.max(0,shape),upper:.005+.033*Math.max(0,shape),lower:.005+.031*Math.max(0,shape),t});
    }else if(eel){
      const shape=Math.max(.025,Math.sin(Math.PI*(.06+.93*t))**.45),taper=1-.65*t;
      stations.push({point,width:a.halfWidth*shape*taper,upper:a.upper*shape*(.9+.1*t),lower:a.lower*shape*(.9+.1*t),t});
    }else{
      const flatten=id==='sawfish'?.55+.45*t:1;
      stations.push({point,width:a.halfWidth*monotone(t,stationT,width),upper:a.upper*monotone(t,stationT,upper)*flatten,lower:a.lower*monotone(t,stationT,lower)*flatten+mouthBump*Math.exp(-(((t-mouthT)/.10)**2)),t});
    }
  }
  if(FIN_FORMS[id]||spec.family==='shark'){
    const end=stations[stations.length-1];stations.push({...end,point:[end.point[0],end.point[1],a.peduncleZ-.025]});
  }
  body.sweep(stations,t=>bodyInfluence(t,bodyCount),sea?12:24);
}

function buildHammer(body:FishGeometry):void {
  const surface=buildSurfaceNets(hammerField,[-1.5,-.65,-2.25],[1.5,.65,1.85],.14),start=body.positions.length/3;
  for(let i=0;i<surface.positions.length;i+=3){
    const x=surface.positions[i]/4.7,y=surface.positions[i+1]/4.7,z=(surface.positions[i+2]+.45)/4.7;
    const index=body.vertex([x,y,z],body.bodyUV(clamp((.42-z)/.78),((Math.atan2(y,x)+Math.PI*2)%(Math.PI*2))/(Math.PI*2)),bodyInfluence(clamp((.42-z)/.78),7));
    const e=.007,dx=modelHammerField(x+e,y,z)-modelHammerField(x-e,y,z),dy=modelHammerField(x,y+e,z)-modelHammerField(x,y-e,z),dz=modelHammerField(x,y,z+e)-modelHammerField(x,y,z-e),length=Math.hypot(dx,dy,dz)||1;
    body.normal(index,[dx/length,dy/length,dz/length]);
  }
  // Check each extracted face against the field gradient rather than trusting extractor winding.
  for(let i=0;i<surface.indices.length;i+=3){
    const ia=surface.indices[i],ib=surface.indices[i+1],ic=surface.indices[i+2],p=surface.positions;
    const ax=p[ib*3]-p[ia*3],ay=p[ib*3+1]-p[ia*3+1],az=p[ib*3+2]-p[ia*3+2],bx=p[ic*3]-p[ia*3],by=p[ic*3+1]-p[ia*3+1],bz=p[ic*3+2]-p[ia*3+2];
    const x=(p[ia*3]+p[ib*3]+p[ic*3])/3,y=(p[ia*3+1]+p[ib*3+1]+p[ic*3+1])/3,z=(p[ia*3+2]+p[ib*3+2]+p[ic*3+2])/3,e=.033;
    const dot=(ay*bz-az*by)*(hammerField(x+e,y,z)-hammerField(x-e,y,z))+(az*bx-ax*bz)*(hammerField(x,y+e,z)-hammerField(x,y-e,z))+(ax*by-ay*bx)*(hammerField(x,y,z+e)-hammerField(x,y,z-e));
    if(dot>=0)body.triangle(start+ia,start+ib,start+ic);else body.triangle(start+ia,start+ic,start+ib);
  }
}

function buildRay(spec:SpeciesSpec,body:FishGeometry):void {
  const a=getFishAnatomy(spec),manta=spec.id==='manta',width=a.halfWidth,start=body.positions.length/3;
  const wingWeight=(span:number):Influence=>{
    const s=clamp((Math.abs(span)-.13)/.87)*3,side=span<0?3:6;
    if(s<=0)return HEAD;const low=Math.floor(s),high=Math.min(3,low+1);return [low===0?0:side+low-1,high===0?0:side+high-1,s-low];
  };
  // One watertight top/bottom disc, 25 chord samples ×33 span samples.
  for(let surface=0;surface<2;surface++)for(let chord=0;chord<25;chord++)for(let span=0;span<33;span++){
    const t=chord/24,q=span/16-1,outline=manta?(.07+.93*Math.sin(Math.PI*t)**.8):(.035+.965*(1-Math.abs(2*t-1)));
    const x=q*width*outline,z=mix(a.headZ,a.peduncleZ,t)+(manta?-.11*Math.abs(q)**1.8*Math.sin(Math.PI*t):0);
    const thickness=(surface===0?a.upper:-a.lower)*Math.max(.025,(1-q*q)*Math.sin(Math.PI*t)**.5),y=thickness-.008*Math.abs(q);
    const angle=surface===0?Math.acos(clamp(q,-1,1)):Math.PI*2-Math.acos(clamp(q,-1,1));
    body.vertex([x,y,z],body.bodyUV(t,angle/(Math.PI*2)),wingWeight(t<.18?0:q));
  }
  const layer=25*33;
  for(let side=0;side<2;side++)for(let j=0;j<24;j++)for(let i=0;i<32;i++){
    const a0=start+side*layer+j*33+i,b=a0+1,d=a0+33,c=d+1;
    if(side===0)body.indices.push(a0,b,d,b,c,d);else body.indices.push(a0,d,b,b,d,c);
  }
  const join=(topA:number,topB:number)=>{body.indices.push(start+topA,start+topB,start+topA+layer,start+topB,start+topB+layer,start+topA+layer);};
  for(let j=0;j<24;j++){join(j*33,(j+1)*33);join((j+1)*33+32,j*33+32);}
  for(let i=0;i<32;i++){join(i+1,i);join(24*33+i,24*33+i+1);}
  const tail:SweepStation[]=[];
  for(let i=0;i<=16;i++){const t=i/16;tail.push({point:[0,.004*Math.sin(t*Math.PI),mix(-.25,a.tailZ,t)],width:mix(.012,.001,t),upper:mix(.012,.001,t),lower:mix(.01,.001,t),t});}
  body.sweep(tail,t=>bodyInfluence(t,3),6);
  if(!manta)body.cone([0,.008,-.52],[0,.045,-.59],.008,[2,2,0],DARK);
}

function addCaudal(spec:SpeciesSpec,fins:FishGeometry,joints:Joint[],form:typeof FIN_FORMS[string],sampler:SurfaceSampler):void {
  const a=getFishAnatomy(spec),id=spec.id,h=form.height,tail=id==='swordtail'?-.55:a.tailZ,ped=a.peduncleZ;
  const endBone=6,betta=id==='betta',color=id==='blue-tang'?new Color(spec.colors[2]).lerp(WHITE,.18):id==='platy'?new Color(spec.colors[1]).lerp(WHITE,.08):undefined;
  const lobes=form.tail==='split'?[-1,1]:[0];
  for(const lobe of lobes){
    const root:Point3[]=[[0,-.95*a.lower*.08,ped-.025],[0,0,ped-.025],[0,.95*a.upper*.08,ped-.025]];
    const edge:Point3[]=[];
    for(let i=0;i<=12;i++){
      const span=i/12,angle=-Math.PI/2+span*Math.PI,sy=Math.sin(angle),round=Math.cos(angle);
      let z=tail,y=sy*h,x=lobe*.035;
      if(form.tail==='halfmoon'){z=ped-.08-.29*round;x+=.014*Math.cos(span*6*Math.PI);}
      else if(form.tail==='delta'){z=tail+.035*round+.008*Math.cos(span*8*Math.PI);}
      else if(form.tail==='fork'){z=tail+.105*round;}
      else if(form.tail==='round'){z=tail+.055*(1-round);}
      else if(form.tail==='split'){z=tail+.095*round;}
      else if(form.tail==='sword'&&span<.22){z=mix(-.78,tail,span/.22);y=mix(-.16,-h*.78,span/.22);}
      edge.push([x,y,z]);
    }
    fins.membrane(root,edge,(span,distal,_root,skin)=>{
      const joint=betta?joints.findIndex(b=>b.kind==='distal'&&b.side===(span<.5?-1:1)):endBone;
      return blendRoot(skin,joint,distal);
    },{fold:betta?.012:.006,solid:color,surface:surface(sampler,2,-1,'caudal')});
  }
}

function addMedianFins(spec:SpeciesSpec,fins:FishGeometry,joints:Joint[],form:typeof FIN_FORMS[string],sampler:SurfaceSampler):void {
  const a=getFishAnatomy(spec),id=spec.id,tall=spec.family==='tall',gourami=spec.family==='gourami';
  const dorsal=(front:number,back:number,height:number,round=false)=>{
    const root:Point3[]=[[0,a.upper*.50,front],[0,a.upper*.85,mix(front,back,.45)],[0,a.upper*.18,back]];
    const edge:Point3[]=round?[[0,a.upper*.65,front],[0,height,front-.055],[0,height,mix(front,back,.55)],[0,a.upper*.20,back]]:
      [[0,a.upper*.65,front],[0,height,mix(front,back,.50)],[0,height*.70,back+.035],[0,a.upper*.20,back]];
    fins.membrane(root,edge,sampledRoot,{fold:id==='betta'?.010:.003,surface:surface(sampler,1,1,'dorsal')});
  };
  if(id==='mandarin'||id==='rainbowfish'){
    dorsal(a.headZ*.52,.015,form.dorsal);dorsal(-.035,a.peduncleZ+.015,form.dorsal*.82,true);
  }else if(id==='puffer'){dorsal(-.05,a.peduncleZ+.02,form.dorsal,true);}
  else if(id==='discus'||id==='yellow-tang'||id==='emperor-angelfish'||id==='blue-tang'){
    fins.membrane([[0,a.upper*.40,a.headZ*.65],[0,a.upper*.92,.015],[0,a.upper*.14,a.peduncleZ]],[[0,a.upper*.48,a.headZ*.65],[0,form.dorsal,.055],[0,form.dorsal*.85,-.13],[0,a.upper*.20,a.peduncleZ]],sampledRoot,{surface:surface(sampler,1,1,'dorsal')});
  }else dorsal(a.headZ*.60,a.peduncleZ+.02,form.dorsal,['molly','goldfish','clownfish','royal-gramma'].includes(id));
  const analFront=id==='betta'?a.headZ*.54:gourami?a.headZ*.35:id==='puffer'?-.055:.025;
  fins.membrane([[0,-a.lower*.56,analFront],[0,-a.lower*.85,-.075],[0,-a.lower*.10,a.peduncleZ]],[[0,-a.lower*.64,analFront],[0,-form.anal,tall?-.09:-.12],[0,-form.anal*.75,a.peduncleZ+.025],[0,-a.lower*.20,a.peduncleZ]],(span,distal,_root,skin)=>
    blendRoot(skin,id==='betta'&&span>.5?joints.findIndex(j=>j.kind==='distal'&&j.side===-1):undefined,distal),
  {fold:id==='betta'?.010:.003,uvScale:id==='white-cloud'?.82:1,surface:surface(sampler,1,-1,'anal')});
  if(id==='blue-cichlid')for(let i=0;i<8;i++){
    const z=.20-i*.043,s=project(sampler,[0,.11,z],1,1,'dorsal spine',-.002);fins.cone(s.point,[0,.215+Math.sin(i/8*Math.PI)*.02,z-.014],.0035,s.skin,new Color(spec.colors[1]));
  }
  if(id==='moorish-idol'){
    fins.membrane([[0,.23,.06],[0,.27,.035],[0,.29,.01]],[[0,.29,.06],[0,.46,.005],[0,.55,-.13],[0,.51,-.28],[0,.44,-.40]],sampledRoot,{fold:.002,surface:surface(sampler,1,1,'dorsal streamer')});
  }
}

function addPairedFins(spec:SpeciesSpec,fins:FishGeometry,joints:Joint[],sampler:SurfaceSampler):void {
  const a=getFishAnatomy(spec),id=spec.id;
  for(const side of [-1,1]){
    const joint=joints.findIndex(j=>j.kind==='pectoral'&&j.side===side);
    const p=a.headZ*.32,w=a.halfWidth,large=id==='mandarin',reach=large?.215:id==='puffer'?.225:w+.075;
    fins.membrane([[side*w*.67,-.006,p+.025],[side*w*.85,-.02,p],[side*w*.70,-.045,p-.025]],[[side*w*.72,.005,p+.025],[side*reach,-.015,p-.035],[side*(reach-.01),-.075,p-.11],[side*w*.74,-.055,p-.045]],(_span,distal,_root,skin)=>blendRoot(skin,joint,distal),{fold:.003,uvScale:id==='white-cloud'?.82:1,surface:surface(sampler,0,side,'pectoral')});
  }
}

function addSharkFins(spec:SpeciesSpec,fins:FishGeometry,joints:Joint[],sampler:SurfaceSampler):void {
  const a=getFishAnatomy(spec),id=spec.id,nurse=id==='nurse-shark',saw=id==='sawfish',zebra=id==='zebra-shark';
  const dorsal=(front:number,back:number,height:number,rounded:boolean)=>{
    const edge:Point3[]=rounded?[[0,.08,front],[0,height,front-.045],[0,height*.95,front-.10],[0,.07,back]]:[[0,.075,front],[0,height,front-.11],[0,height*.78,front-.14],[0,.06,back]];
    fins.membrane([[0,.065,front],[0,.07,mix(front,back,.5)],[0,.045,back]],edge,sampledRoot,{surface:surface(sampler,1,1,'shark dorsal')});
  };
  dorsal(nurse?.14:.19,nurse?-.12:-.16,nurse?.235:id==='whale-shark'?.26:.285,nurse);
  dorsal(-.20,-.34,nurse?.18:.14,true);
  for(const side of [-1,1]){
    const joint=joints.findIndex(j=>j.kind==='pectoral'&&j.side===side),reach=saw?.35:id==='whale-shark'?.34:.29;
    fins.membrane([[side*a.halfWidth*.55,-.035,.20],[side*a.halfWidth,-.045,.08],[side*a.halfWidth*.7,-.04,-.05]],[[side*a.halfWidth*.6,-.035,.20],[side*reach,-.055,-.05],[side*(reach-.015),-.06,-.15],[side*a.halfWidth*.7,-.04,-.05]],(_span,distal,_root,skin)=>blendRoot(skin,joint,distal),{surface:surface(sampler,0,side,'shark pectoral')});
    fins.membrane([[side*.055,-.035,-.17],[side*.035,-.045,-.29]],[[side*.06,-.04,-.17],[side*.14,-.075,-.28],[side*.045,-.045,-.32]],sampledRoot,{uvScale:.78,surface:surface(sampler,0,side,'shark pelvic')});
  }
  if(id==='thresher-shark'){
    const extra1=joints.findIndex(j=>j.name==='upper-tail-1'),extra2=joints.findIndex(j=>j.name==='upper-tail-2');
    const upperRoot=project(sampler,[0,.005,a.peduncleZ],2,-1,'upper caudal',-.002),lowerRoot=project(sampler,[0,0,a.peduncleZ],2,-1,'lower caudal',-.002);
    fins.membrane([upperRoot.point,[0,.02,-.43],[0,.035,-.48]],[[0,.02,a.peduncleZ],[0,.18,-.58],[0,.33,-.81],[0,.40,-1.02]],(span,distal)=>blendRoot(span===0?upperRoot.skin:{indices:[6,extra1,0,0],weights:[1-span,span,0,0]},span<.5?extra1:extra2,distal));
    fins.membrane([lowerRoot.point,[0,-.02,-.43]],[[0,-.015,a.peduncleZ],[0,-.13,-.56],[0,-.09,-.53]],(span)=>span===0?lowerRoot.skin:blendRoot(lowerRoot.skin,6,span));
  }else{
    const tip=zebra?-.98:nurse?-.61:id==='hammerhead'?-.51:a.tailZ,upper=zebra?.17:nurse?.17:.245,lowerTip=id==='hammerhead'?-.52:zebra?-.67:-.57;
    const root=project(sampler,[0,-.005,a.peduncleZ],2,-1,'shark caudal',-.002);
    fins.membrane([root.point,[0,.005,a.peduncleZ-.025],[0,.025,a.peduncleZ]],[[0,-.13,lowerTip],[0,-.045,a.peduncleZ-.12],[0,.015,a.peduncleZ-.10],[0,upper,tip],[0,upper*.78,tip+.035]],(span,distal)=>blendRoot(span===0?root.skin:{indices:[6,0,0,0],weights:[1,0,0,0]},6,distal),{fold:.002});
  }
}

function addHeadAnatomy(spec:SpeciesSpec,body:FishGeometry):void {
  const a=getFishAnatomy(spec),id=spec.id,skin=new Color(spec.colors[0]);
  if(id==='copperband'||id==='seahorse'||id==='ribbon-eel'){
    const start:Point3=id==='copperband'?[0,-.008,.25]:id==='seahorse'?[0,.29,.07]:[0,0,.35];
    const end=[...a.mouth] as Point3,r=id==='copperband'?.029:id==='seahorse'?.031:.018;
    const snout:SweepStation[]=[];for(let i=0;i<=12;i++){const t=i/12;snout.push({point:lerpPoint(start,end,t),width:mix(r,r*.35,t),upper:mix(r,r*.4,t),lower:mix(r*.8,r*.3,t),t:t*.12});}
    body.sweep(snout,()=>HEAD,12);
  }
  if(id==='sawfish'){
    const snout:SweepStation[]=[];for(let i=0;i<=12;i++){const t=i/12;snout.push({point:[0,-.006,mix(.28,.78,t)],width:mix(.055,.023,t),upper:.009,lower:.009,t:t*.14});}body.sweep(snout,()=>HEAD,8);
    for(const side of [-1,1])for(let i=0;i<10;i++){
      const t=i/9,z=.38+i*.038,w=mix(.048,.026,t);body.cone([side*w,-.005,z],[side*(w+.031),-.005,z-.012],.007,HEAD,skin,5);
    }
  }
  if(id==='seahorse')body.ellipsoid([0,.307,.072],[.040,.043,.065],HEAD,skin,5,8);
}

function addSpecialAnatomy(spec:SpeciesSpec,body:FishGeometry,fins:FishGeometry,joints:Joint[],centerline:Point3[],sampler:SurfaceSampler):void {
  const a=getFishAnatomy(spec),id=spec.id,skin=new Color(spec.colors[0]),accent=new Color(spec.colors[1]);
  if(id==='manta')for(const side of [-1,1]){
    const root:Point3[]=[[side*.07,-.012,.23],[side*.08,-.01,.30],[side*.09,-.008,.35]];
    const edge:Point3[]=[[side*.13,-.01,.24],[side*.16,.018,.34],[side*.12,.025,.39],[side*.08,.005,.37]];
    fins.membrane(root,edge,sampledRoot,{fold:.002,surface:surface(sampler,1,-1,'cephalic lobe')});
  }
  if(id==='puffer')for(let row=0;row<5;row++)for(let i=0;i<9;i++){
    const t=.18+row*.13,z=mix(a.headZ,a.peduncleZ,t),angle=(i+.5*(row%2))/9*Math.PI*2,profile=monotone(t,STATIONS,WIDTH),x=Math.cos(angle)*a.halfWidth*profile,y=Math.sin(angle)*(Math.sin(angle)>0?a.upper:a.lower)*profile;
    const axis=Math.abs(Math.cos(angle))>.7?0:1,side=axis===0?Math.sign(x):Math.sign(y),s=project(sampler,[x,y,z],axis,side,'spine',-.002);
    body.cone(s.point,[s.point[0]+s.normal[0]*.019,s.point[1]+s.normal[1]*.019,s.point[2]+s.normal[2]*.019],.0045,s.skin,skin.clone().lerp(WHITE,.24),5);
  }
  if(id==='yellow-tang')for(const side of [-1,1]){
    const s=project(sampler,[side*.009,.001,-.205],0,side,'caudal spine',-.002);body.cone(s.point,[side*.025,.001,-.23],.005,s.skin,new Color(spec.colors[2]),5);
  }
  if(id==='koi'||id==='nurse-shark')for(const side of [-1,1]){
    const z=id==='koi'?.35:.29,y=id==='koi'?-.03:-.067;
    const s=project(sampler,[side*.014,y,z],1,-1,'barbel',-.002);
    body.line([s.point,[side*.03,y-.018,z+.012],[side*.035,y-.025,z-.012]],.002,s.skin,skin,6);
  }
  if(spec.family==='gourami'||id==='angelfish')for(const side of [-1,1]){
    const low=id==='angelfish'?-.46:Math.max(-a.lower-.085,getFishAvoidanceBox(spec).min[1]+.02);
    const s=project(sampler,[side*.018,-a.lower*.65,.075],1,-1,'pelvic streamer',-.002);
    body.line([s.point,[side*.025,low+.055,-.015],[side*.035,low,-.105],[side*.045,low+.015,-.19]],.0022,s.skin,skin.clone().lerp(WHITE,.3),12);
  }
  if(id==='lionfish'){
    for(let i=0;i<10;i++){
      const z=.23-i*.047,tip:Point3=[0,.31+Math.sin(i/9*Math.PI)*.115,z-.06];
      const s=project(sampler,[0,.11,z],1,1,'lion spine',-.002);body.cone(s.point,tip,.005,s.skin,i%2?skin:accent,5);
    }
    for(const side of [-1,1]){
      const joint=joints.findIndex(j=>j.kind==='distal'&&j.side===side);
      const root:Point3[]=[[side*.07,.02,.18],[side*.09,-.01,.06],[side*.06,-.04,-.15]],edge:Point3[]=[];
      for(let i=0;i<=12;i++){const t=i/12;edge.push([side*(.19+.16*Math.sin(t*Math.PI)),.02-.16*t,.20-.48*t]);}
      fins.membrane(root,edge,(_span,distal,_root,weights)=>blendRoot(weights,joint,distal),{fold:.004,surface:surface(sampler,0,side,'lion fan')});
      for(let i=0;i<7;i++){
        const t=i/6,p=curve(edge,t),r=project(sampler,curve(root,t),0,side,'lion ray',-.002);body.cone(r.point,p,.0038,r.skin,i%2?skin:accent,5,[joint,joint,0]);
      }
      const s=project(sampler,[side*.045,.065,.24],0,side,'lion horn',-.002);body.cone(s.point,[side*.047,.115,.225],.008,s.skin,skin,5);
    }
  }
  if(id==='zebra-shark'||id==='whale-shark')for(const side of [-1,0,1]){
    const ridge:Point3[]=[],weights:SkinWeights[]=[];
    for(let i=0;i<=16;i++){
      const t=.26+i/16*.57,profile=monotone(t,STATIONS,UPPER),s=project(sampler,[side*a.halfWidth*.5*profile,0,mix(a.headZ,a.peduncleZ,t)],1,1,'ridge',.001);
      ridge.push(s.point);weights.push(s.skin);
    }
    for(let i=0;i<ridge.length-1;i++)body.line([ridge[i],ridge[i+1]],.002,weights[i],skin,1);
  }
  if(spec.family==='eel'){
    const root:Point3[]=[],edge:Point3[]=[];
    for(let i=0;i<=24;i++){
      const t=i/24,p=curve(centerline,t),shape=Math.max(.025,Math.sin(Math.PI*(.06+.93*t))**.45);
      root.push([p[0],p[1]+a.upper*shape*.92,p[2]]);edge.push([p[0],p[1]+a.upper*shape+.025+(id==='oarfish'?.018:.0)*Math.sin(t*Math.PI),p[2]]);
    }
    // Two seamless adjoining membrane sections preserve a continuous dorsal edge.
    for(let half=0;half<2;half++)fins.membrane(root.slice(half*12,half*12+13),edge.slice(half*12,half*12+13),sampledRoot,{fold:.001,surface:surface(sampler,1,1,'eel dorsal')});
    if(id==='oarfish'){
      for(let i=0;i<5;i++){const s=project(sampler,[0,.035,.38-i*.015],1,1,'oarfish crest',-.002);body.cone(s.point,[0,.245-i*.025,.36-i*.035],.003,s.skin,accent,5);}
      for(const side of [-1,1]){const s=project(sampler,[side*.011,-.025,.31],1,-1,'oarfish streamer',-.002);body.line([s.point,[side*.025,-.105,.18],[side*.04,-.12,-.03]],.0018,s.skin,accent,10);}
    }else for(const side of [-1,1])fins.membrane([[side*.008,.008,.41],[side*.013,.014,.425]],[[side*.012,.012,.41],[side*.057,.042,.44],[side*.033,.026,.46]],sampledRoot,{fold:.001,surface:surface(sampler,0,side,'eel nasal fin')});
  }
  if(id==='seahorse'){
    // Raised bony rings follow the swept arc, not global Y or a wagging spiral.
    for(let ring=2;ring<17;ring++){
      const t=ring/25,p=curve(centerline,t),before=curve(centerline,t-.002),after=curve(centerline,t+.002),tangent=new Vector3(after[0]-before[0],after[1]-before[1],after[2]-before[2]).normalize(),up=new Vector3(1,0,0).cross(tangent).normalize();
      const shape=t<.58?Math.sin(Math.PI*clamp(t/.72)):.27*(1-(t-.58)/.46),w=.004+.055*shape,h=.006+.034*shape;
      for(let side=0;side<6;side++){
        const angle=side/6*Math.PI*2,next=(side+1)/6*Math.PI*2;
        const samples=[angle,next].map(theta=>{
          const direction:Point3=[Math.cos(theta),up.y*Math.sin(theta),up.z*Math.sin(theta)];
          const guide:Point3=[p[0]+direction[0]*w*.7,p[1]+direction[1]*h*.7,p[2]+direction[2]*h*.7];
          const axis:0|1|2=Math.abs(direction[0])>=Math.max(Math.abs(direction[1]),Math.abs(direction[2]))?0:Math.abs(direction[1])>=Math.abs(direction[2])?1:2;
          return project(sampler,guide,axis,Math.sign(direction[axis]),'bony ring',.001,false);
        });
        body.line(samples.map(s=>s.point),.0017,samples[0].skin,accent,1);
      }
    }
    for(let i=0;i<4;i++){const s=project(sampler,[0,.34,.02+i*.018],1,1,'coronet',-.002);body.cone(s.point,[0,.405-i*.012,.018+i*.018],.008,s.skin,skin,5);}
    const dorsal=joints.findIndex(j=>j.kind==='dorsal');fins.membrane([[0,.16,-.027],[0,.055,-.07]],[[0,.17,-.04],[0,.095,-.135],[0,.035,-.08]],(_span,distal,_root,weights)=>blendRoot(weights,dorsal,distal),{fold:.001,surface:surface(sampler,2,-1,'seahorse dorsal')});
  }
  if(id==='sunfish'){
    const dorsal=joints.findIndex(j=>j.kind==='dorsal'),anal=joints.findIndex(j=>j.kind==='anal');
    fins.membrane([[0,.18,.035],[0,.17,-.17]],[[0,.18,.035],[0,.45,-.09],[0,.43,-.16],[0,.18,-.22]],(_span,distal,_root,weights)=>blendRoot(weights,dorsal,distal),{surface:surface(sampler,1,1,'sunfish dorsal')});
    fins.membrane([[0,-.18,.035],[0,-.17,-.17]],[[0,-.18,.035],[0,-.45,-.09],[0,-.42,-.16],[0,-.18,-.22]],(_span,distal,_root,weights)=>blendRoot(weights,anal,distal),{surface:surface(sampler,1,-1,'sunfish anal')});
    const edge:Point3[]=[];for(let i=0;i<=12;i++)edge.push([0,mix(-.19,.19,i/12),-.33+.014*Math.cos(i/12*Math.PI*10)]);
    fins.membrane([[0,-.17,-.215],[0,.17,-.215]],edge,sampledRoot,{surface:surface(sampler,2,-1,'clavus')});
    for(const side of [-1,1])fins.membrane([[side*.045,.04,.10],[side*.055,-.02,.10]],[[side*.045,.04,.10],[side*.105,.015,.015],[side*.07,-.03,.04]],sampledRoot,{uvScale:.8,surface:surface(sampler,0,side,'sunfish pectoral')});
  }
}

function addFace(spec:SpeciesSpec,body:FishGeometry,eyes:FishGeometry,sampler:SurfaceSampler):void {
  const a=getFishAnatomy(spec),id=spec.id,ray=spec.family==='ray',shark=spec.family==='shark',sea=id==='seahorse',eel=spec.family==='eel',skin=new Color(spec.colors[0]),seam=skin.clone().lerp(DARK,.62);
  let eyeY=a.upper*.34,eyeZ=a.headZ-(a.headZ-a.peduncleZ)*.15,eyeX=a.halfWidth*.76;
  if(id==='hammerhead'){eyeX=.265;eyeY=.013;eyeZ=.315;}
  if(ray){eyeX=.066;eyeY=a.upper*.90;eyeZ=.22;}
  if(sea){eyeX=.036;eyeY=.322;eyeZ=.093;}
  if(eel){eyeX=a.halfWidth*.74;eyeY=.018;eyeZ=.386;}
  if(id==='sawfish'){eyeX=.073;eyeY=.067;eyeZ=.23;}
  if(id==='whale-shark'){eyeX=.112;eyeY=.014;eyeZ=.355;}
  if(id==='nurse-shark'){eyeX=.085;eyeY=.026;eyeZ=.272;}
  if(id==='mandarin'){eyeX=.071;eyeY=.070;eyeZ=.23;}
  const radius=id==='puffer'?.024:id==='mandarin'?.016:id==='whale-shark'?.010:id==='hammerhead'?.011:sea?.010:clamp(.11*Math.min(a.upper,a.lower),.006,.014);
  for(const side of [-1,1]){
    const s=project(sampler,[side*eyeX,eyeY,eyeZ],ray||id==='sawfish'?1:0,ray||id==='sawfish'?1:side,'eye',0);
    const center=(distance:number):Point3=>[s.point[0]+s.normal[0]*distance,s.point[1]+s.normal[1]*distance,s.point[2]+s.normal[2]*distance];
    body.orientedEllipsoid(center(-.30*radius),s.normal,[.45*radius,1.05*radius,1.05*radius],s.skin,seam,4,10);
    eyes.orientedEllipsoid(center(.02*radius),s.normal,[.22*radius,.76*radius,.76*radius],s.skin,skin.clone().lerp(new Color('#c8b17a'),.65),4,10);
    eyes.orientedEllipsoid(center(.18*radius),s.normal,[.10*radius,.43*radius,.48*radius],s.skin,PUPIL,4,10);
  }
  // The opening is recessed inside a geometric lip annulus at the actual food anchor.
  const mouth=[...a.mouth] as Point3,ventral=ray||(shark&&id!=='whale-shark'),mw=id==='manta'?.070:id==='whale-shark'?.10:id==='hammerhead'?.035:sea?.009:id==='copperband'?.008:eel?.005:shark||ray?.019:Math.min(.019,a.halfWidth*headForm(spec)[0]*.90),mh=id==='whale-shark'?.010:.005;
  const normal:Point3=ventral?[0,-1,0]:[0,0,1],up:Point3=ventral?[0,0,1]:[0,1,0],rim:Point3[]=[];
  for(let i=0;i<=16;i++){
    const angle=i/16*Math.PI*2,p:Point3=[mouth[0]+Math.cos(angle)*mw,mouth[1]+Math.sin(angle)*mh*up[1],mouth[2]+Math.sin(angle)*mh*up[2]];
    body.attachToSkin(p,ventral);rim.push(p);
  }
  body.openMouth(mouth,mw*.72,mh*.72,ventral);
  const start=body.positions.length/3;
  for(let ring=0;ring<3;ring++)for(let i=0;i<=16;i++){
    const angle=i/16*Math.PI*2,r=ring===1?.72:0,depth=ring===1?-.0008:-.003;
    const p:Point3=ring===0?rim[i]:[mouth[0]+Math.cos(angle)*mw*r,mouth[1]+Math.sin(angle)*mh*r*up[1]+depth*normal[1],mouth[2]+Math.sin(angle)*mh*r*up[2]+depth*normal[2]];
    body.vertex(p,WHITE_UV,HEAD,ring===0?skin.clone().lerp(WHITE,.06):DARK);
  }
  for(let ring=0;ring<2;ring++)for(let i=0;i<16;i++){
    const a0=start+ring*17+i,b=a0+1,c=b+17,d=a0+17;
    body.indices.push(a0,b,d,b,c,d);
  }
  const seamLine=(guides:Point3[],axis:0|1|2,side:number,region:string,segments:number)=>{
    const samples=guides.map(p=>project(sampler,p,axis,side,region));
    body.line(samples.map(s=>s.point),.001,samples[Math.floor(samples.length/2)].skin,seam,segments);
  };
  if(ray||id==='sawfish'){
    for(const side of [-1,1]){
      const z=id==='sawfish'?.185:.17,x=id==='sawfish'?.063:.09;
      const s=project(sampler,[side*x,0,z],1,1,'spiracle');body.orientedEllipsoid(s.point,s.normal,[.002,.014,.020],s.skin,DARK,3,8);
      for(let i=0;i<5;i++)seamLine([[side*.044,-.032,.14-i*.024],[side*.078,-.035,.146-i*.024],[side*.098,-.028,.136-i*.024]],1,-1,'ventral gill',4);
    }
  }else if(shark){
    for(const side of [-1,1])for(let i=0;i<5;i++){
      const z=.17-i*.022,t=clamp((a.headZ-z)/(a.headZ-a.peduncleZ)),x=a.halfWidth*monotone(t,STATIONS,WIDTH);
      seamLine([[side*x*.92,.035,z+.007],[side*(x+.001),.002,z],[side*x*.92,-.033,z+.005]],0,side,'shark gill',4);
    }
  }else if(eel||sea){
    const centerline=sea?buildCenterline(spec):[];
    const seaZ=(y:number):number=>{
      for(let i=1;i<centerline.length;i++){const a=centerline[i-1],b=centerline[i];if((y-a[1])*(y-b[1])<=0&&a[1]!==b[1])return mix(a[2],b[2],(y-a[1])/(b[1]-a[1]));}
      throw new Error('missing seahorse gill centerline');
    };
    for(const side of [-1,1])seamLine(sea?[.25,.235,.225].map(y=>[side*.043,y,seaZ(y)] as Point3):[[side*a.halfWidth,.018,.31],[side*(a.halfWidth+.001),0,.305],[side*a.halfWidth,-.018,.31]],0,side,'gill opening',5);
  }else{
    const z=a.headZ-(a.headZ-a.peduncleZ)*.24,x=a.halfWidth;
    for(const side of [-1,1])seamLine([[side*x*.66,a.upper*.56,z+.045],[side*x*.98,a.upper*.20,z],[side*x*.96,-a.lower*.28,z-.008],[side*x*.65,-a.lower*.65,z+.024]],0,side,'operculum',7);
  }
}

function buildSpecies(spec:SpeciesSpec):ModelData {
  const resources:Array<BufferGeometry|MeshStandardMaterial>=[];
  try{
    const body=new FishGeometry(.5/(['discus','mandarin','emperor-angelfish','whale-shark'].includes(spec.id)?512:256)),fins=new FishGeometry(),eyes=new FishGeometry(),centerline=buildCenterline(spec),joints=buildJoints(spec,centerline),bodyCount=joints.filter(j=>j.kind==='body').length;
    if(spec.id==='hammerhead')buildHammer(body);
    else if(spec.family==='ray')buildRay(spec,body);
    else buildSweep(spec,body,centerline,bodyCount);
    addHeadAnatomy(spec,body);
    const sampler=body.createSurfaceSampler();
    if(spec.family==='shark')addSharkFins(spec,fins,joints,sampler);
    else if(FIN_FORMS[spec.id]){
      const form=FIN_FORMS[spec.id];addCaudal(spec,fins,joints,form,sampler);addMedianFins(spec,fins,joints,form,sampler);addPairedFins(spec,fins,joints,sampler);
    }else if(!['ray','eel','seahorse'].includes(spec.family)&&spec.id!=='sunfish')throw new Error('Missing species silhouette');
    addSpecialAnatomy(spec,body,fins,joints,centerline,sampler);addFace(spec,body,eyes,sampler);
    const geometry=body.finish();resources.push(geometry);const finGeometry=fins.finish();resources.push(finGeometry);const eyeGeometry=eyes.finish();resources.push(eyeGeometry);
    const triangles=(body.indices.length+fins.indices.length+eyes.indices.length)/3;
    if(triangles>6000||joints.length>14)throw new Error(`Model budget exceeded: ${triangles} triangles, ${joints.length} bones`);
    // A shared conservative picking envelope includes every fin and its animation excursion.
    const box=getFishAvoidanceBox(spec),center=new Vector3((box.min[0]+box.max[0])/2,(box.min[1]+box.max[1])/2,(box.min[2]+box.max[2])/2),radius=Math.hypot(box.max[0]-box.min[0],box.max[1]-box.min[1],box.max[2]-box.min[2])/2;
    for(const part of [geometry,finGeometry,eyeGeometry])if(part.boundingSphere){part.boundingSphere.center.copy(center);part.boundingSphere.radius=radius;}
    const textures=getFishTextures(spec),smooth=spec.family==='shark'||spec.family==='ray',roughness=spec.family==='shark'?.52:spec.family==='ray'?.55:spec.family==='eel'?.33:spec.family==='puffer'?.50:spec.family==='seahorse'?.62:.34;
    const material=new MeshStandardMaterial({map:textures.map,normalMap:textures.normalMap,roughnessMap:textures.roughnessMap,normalScale:new Vector2(smooth?.08:.12,smooth?.08:.12),vertexColors:true,roughness,metalness:0,side:FrontSide});resources.push(material);
    const finMaterial=new MeshStandardMaterial({map:textures.map,vertexColors:true,roughness:.48,metalness:0,side:DoubleSide});resources.push(finMaterial);
    const eyeMaterial=new MeshStandardMaterial({vertexColors:true,roughness:.09,metalness:0,side:FrontSide});resources.push(eyeMaterial);
    const result={geometry,finGeometry,eyeGeometry,material,finMaterial,eyeMaterial,joints};cache[spec.id]=result;return result;
  }catch(error){
    for(const resource of resources)resource.dispose();
    throw new Error(`Fish model ${spec.id}: ${error instanceof Error?error.message:String(error)}`,{cause:error});
  }
}

/** Shared geometry/materials; independent skeleton and highlight materials per animal. */
export function createFishModel(spec:SpeciesSpec):FishModel {
  const data=cache[spec.id]??buildSpecies(spec),a=getFishAnatomy(spec),root=new Group(),posePivot=new Group(),content=new Group(),bones:Bone[]=[];
  posePivot.name='mouth-anchor';posePivot.position.set(...a.mouth);content.position.set(-a.mouth[0],-a.mouth[1],-a.mouth[2]);root.add(posePivot);posePivot.add(content);
  for(const joint of data.joints){const bone=new Bone();bone.name=joint.name;bone.position.set(...joint.position);if(bones.length)bones[0].add(bone);bones.push(bone);}
  const skeleton=new Skeleton(bones),mesh=new SkinnedMesh(data.geometry,data.material),finMesh=new SkinnedMesh(data.finGeometry,data.finMaterial),eyeMesh=new SkinnedMesh(data.eyeGeometry,data.eyeMaterial);
  mesh.add(bones[0]);content.add(mesh,finMesh,eyeMesh);root.updateMatrixWorld(true);
  // Identity bind matrices keep all three passes in one local model coordinate system.
  mesh.bind(skeleton);finMesh.bind(skeleton,mesh.bindMatrix);eyeMesh.bind(skeleton,mesh.bindMatrix);
  for(const part of [mesh,finMesh,eyeMesh]){part.frustumCulled=false;if(part.geometry.boundingSphere)part.boundingSphere=part.geometry.boundingSphere.clone();else part.computeBoundingSphere();}
  mesh.castShadow=true;
  const base=[data.material,data.finMaterial,data.eyeMaterial],parts=[mesh,finMesh,eyeMesh];
  let highlight:'none'|'hovered'|'selected'='none',clones:MeshStandardMaterial[]|null=null,disposed=false;
  const family=spec.family,cruise=MOTION[family].cruise*(MOTION_OVERRIDES[spec.id]?.[0]??1);
  return {root,mesh,bones,
    animate(phase,turnRate,growth,speed,verticalSpeed){
      root.scale.setScalar(getFishModelScale(spec,growth));
      const effort=clamp(speed/cruise,.35,1.4),pitch=family==='seahorse'?0:clamp(-Math.atan2(verticalSpeed,Math.max(speed,.05)),-.20,.20),bank=family==='seahorse'?0:clamp(-.08*turnRate,family==='ray'?-.08:-.16,family==='ray'?.08:.16);
      posePivot.rotation.set(pitch,0,bank);
      for(let i=1;i<bones.length;i++){
        const joint=data.joints[i],bone=bones[i],t=joint.t;
        bone.rotation.set(0,0,0);
        if(joint.kind==='body'){
          if(family==='ray')bone.rotation.y=Math.sin(phase-t*2)*.012*t*effort;
          else if(family==='seahorse')bone.rotation.z=t<.55?Math.sin(phase*.5-t*2)*.008:0;
          else if(spec.id==='sunfish')bone.rotation.y=Math.sin(phase-t)*.007*t*effort;
          else{
            const amplitude=family==='eel'?.02+.22*t*t:family==='shark'?.008+.09*t*t:.015+.12*t*t;
            bone.rotation.y=Math.sin(phase-t*3.8)*amplitude*effort;
          }
        }else if(joint.kind==='wing')bone.rotation.z=joint.side*Math.sin(phase-t*.45)*(.05+.19*t)*effort;
        else if(joint.kind==='pectoral'){
          const flutter=spec.id==='puffer'?3:spec.id==='betta'?2.4:1.4;
          bone.rotation.z=joint.side*Math.sin(phase*flutter)*.13*effort;bone.rotation.y=joint.side*Math.sin(phase*flutter-.45)*.055*effort;
        }else if(joint.kind==='distal'){
          if(spec.id==='thresher-shark')bone.rotation.y=Math.sin(phase-3.8-t*.45)*.08*t*effort;
          else if(spec.id==='lionfish')bone.rotation.z=joint.side*Math.sin(phase-.45)*.12*effort;
          else bone.rotation.y=Math.sin(phase-3.8-.45)*.12*effort;
        }else if(spec.id==='sunfish')bone.rotation.y=Math.sin(phase+(joint.kind==='anal'?Math.PI:0))*.28*effort;
        else bone.rotation.y=Math.sin(phase*2.5)*.22*effort;
      }
      // bone0 deliberately remains rigid: mouth, face and head never receive the S-wave.
    },
    setHighlight(state){
      if(state===highlight||disposed)return;highlight=state;
      if(state==='none'){
        for(let i=0;i<parts.length;i++)parts[i].material=base[i];
        if(clones)for(const material of clones)material.dispose();clones=null;return;
      }
      if(!clones)clones=base.map(material=>material.clone());
      for(let i=0;i<parts.length;i++){
        const material=clones[i];material.emissive.set(state==='selected'?'#16c3a0':'#59c7ef');material.emissiveIntensity=state==='selected'?.18:.10;parts[i].material=material;
      }
    },
    dispose(){
      if(disposed)return;disposed=true;if(clones)for(const material of clones)material.dispose();clones=null;
      skeleton.dispose();root.removeFromParent();
    },
  };
}

export function disposeFishResources():void {
  for(const id of Object.keys(cache)){
    const data=cache[id];data.geometry.dispose();data.finGeometry.dispose();data.eyeGeometry.dispose();data.material.dispose();data.finMaterial.dispose();data.eyeMaterial.dispose();delete cache[id];
  }
  disposeFishTextures();
}

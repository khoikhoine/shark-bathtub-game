import type { SpeciesSpec, Vec3 } from '../sim/types.ts';
import { SPECIES } from './catalog.ts';
import { RARITY } from './balance.ts';

export interface FishAnatomy {
  halfWidth:number; upper:number; lower:number;
  headZ:number; peduncleZ:number; tailZ:number;
  mouth:Readonly<Vec3>;
}
type Profile = Omit<FishAnatomy,'mouth'>;
const profile = (halfWidth:number,upper:number,lower:number,headZ:number,peduncleZ:number,tailZ:number):Profile => ({halfWidth,upper,lower,headZ,peduncleZ,tailZ});
const families:Readonly<Record<string,Profile>> = {
  livebearer:profile(.065,.10,.12,.36,-.25,-.55), goldfish:profile(.11,.14,.18,.34,-.22,-.62),
  minnow:profile(.045,.065,.075,.40,-.30,-.54), flowing:profile(.070,.10,.11,.34,-.22,-.64),
  tall:profile(.045,.22,.22,.28,-.24,-.43), reef:profile(.070,.15,.15,.35,-.25,-.52),
  gourami:profile(.065,.16,.17,.35,-.26,-.50), puffer:profile(.185,.20,.20,.30,-.21,-.45),
  lionfish:profile(.11,.15,.16,.34,-.26,-.52), shark:profile(.105,.095,.095,.42,-.36,-.61),
  ray:profile(.43,.05,.035,.36,-.30,-.95), eel:profile(.028,.04,.04,.445,-.55,-.70),
  seahorse:profile(.060,.34,.34,.23,-.12,-.20),
};
const overrides:Readonly<Record<string,Partial<Profile>>> = {
  'zebra-danio':{upper:.055,lower:.060}, platy:{halfWidth:.085,upper:.12,lower:.14,peduncleZ:-.21,tailZ:-.46},
  molly:{halfWidth:.08,lower:.145}, swordtail:{halfWidth:.055,tailZ:-.78}, discus:{halfWidth:.04},
  koi:profile(.085,.10,.12,.40,-.32,-.58), clownfish:profile(.075,.13,.14,.34,-.24,-.50),
  'blue-tang':{halfWidth:.055,upper:.20,lower:.20}, 'yellow-tang':{halfWidth:.04,upper:.23,lower:.23,headZ:.34},
  'royal-gramma':profile(.055,.095,.10,.40,-.30,-.53), mandarin:profile(.105,.08,.11,.32,-.24,-.49),
  copperband:{halfWidth:.04,upper:.21,lower:.21,headZ:.28}, 'emperor-angelfish':{halfWidth:.075,upper:.19,lower:.19},
  'blue-cichlid':profile(.10,.17,.17,.37,-.28,-.56), 'dwarf-gourami':{upper:.18,lower:.18,peduncleZ:-.22,tailZ:-.47},
  rainbowfish:{halfWidth:.075,upper:.17,lower:.16}, sunfish:profile(.065,.29,.29,.27,-.22,-.34),
  manta:{halfWidth:.62,upper:.055,lower:.035,headZ:.40,tailZ:-.92}, 'nurse-shark':{halfWidth:.13,upper:.10,lower:.085},
  'zebra-shark':{tailZ:-.98}, 'whale-shark':{halfWidth:.185,upper:.12,lower:.10,headZ:.44},
  'thresher-shark':{tailZ:-1.02}, sawfish:{headZ:.78}, oarfish:{halfWidth:.02,upper:.09,lower:.09,tailZ:-.90},
};
const mouthY:Readonly<Record<string,number>> = {
  'neon-tetra':-.005,'zebra-danio':-.005,'white-cloud':-.005,rainbowfish:-.005,goldfish:-.035,koi:-.035,
  molly:.015,betta:.015,angelfish:-.015,discus:-.015,'moorish-idol':-.015,'blue-gourami':-.015,'dwarf-gourami':-.015,
};
const mouths:Readonly<Record<string,Readonly<Vec3>>> = {
  mandarin:[0,-.045,.32], copperband:[0,-.025,.49], hammerhead:[0,-.045,.37], 'nurse-shark':[0,-.065,.31],
  'whale-shark':[0,-.04,.44], sawfish:[0,-.04,.28], stingray:[0,-.035,.22], manta:[0,-.02,.37],
  seahorse:[0,.30,.23], 'ribbon-eel':[0,0,.445], oarfish:[0,0,.445],
};
type Box = Readonly<{min:Readonly<Vec3>;max:Readonly<Vec3>}>;
const anatomyCache = new Map<string,Readonly<FishAnatomy>>();
const boxCache = new Map<string,Box>();
export function getFishAnatomy(spec:SpeciesSpec):Readonly<FishAnatomy> {
  const cached=anatomyCache.get(spec.id);if(cached)return cached;
  if(!Object.hasOwn(SPECIES,spec.id)||!Object.hasOwn(families,spec.family))throw new Error(`Missing fish anatomy: ${spec.id}`);
  const body={...families[spec.family],...overrides[spec.id]};
  const mouth=Object.freeze([...(mouths[spec.id]??[0,mouthY[spec.id]??-.02,body.headZ])]) as Readonly<Vec3>;
  const result=Object.freeze({...body,mouth});anatomyCache.set(spec.id,result);return result;
}
const envelopes:Readonly<Record<string,readonly [number,number,number,number?,number?]>> = {
  guppy:[.24,-.28,.28],betta:[.26,-.35,.35],angelfish:[.24,-.50,.46],discus:[.23,-.28,.28],
  'moorish-idol':[.24,-.35,.60,-.46,.40],sunfish:[.24,-.50,.50],lionfish:[.40,-.23,.48],puffer:[.25,-.25,.25],
  shark:[.37,-.20,.34],hammerhead:[.32,-.18,.34,-.56,.50],'nurse-shark':[.37,-.18,.29],
  'whale-shark':[.38,-.18,.32],'thresher-shark':[.37,-.20,.46,-1.06,.46],sawfish:[.39,-.20,.34,-.65,.82],
  'ribbon-eel':[.32,-.10,.14],oarfish:[.32,-.15,.28],seahorse:[.09,-.38,.43,-.25,.28],
};
export function getFishAvoidanceBox(spec:SpeciesSpec):Box {
  const cached=boxCache.get(spec.id);if(cached)return cached;
  const a=getFishAnatomy(spec),e=envelopes[spec.id]??envelopes[spec.family];
  const x=e?.[0]??(spec.family==='ray'?a.halfWidth+.05:Math.max(a.halfWidth,.16)+.08);
  const result=Object.freeze({min:Object.freeze([-x,e?.[1]??(spec.family==='ray'?-.22:-a.lower-.10),e?.[3]??a.tailZ-.04]) as Readonly<Vec3>,max:Object.freeze([x,e?.[2]??(spec.family==='ray'?.22:a.upper+.12),e?.[4]??Math.max(a.headZ,a.mouth[2])+.04]) as Readonly<Vec3>});
  boxCache.set(spec.id,result);return result;
}
export function getFishModelScale(spec:SpeciesSpec,growth:number):number {
  return RARITY[spec.rarity].length*(.9+.05*(spec.index%5))*(.45+.55*growth);
}
export function writeFishMouthWorld(out:Vec3,spec:SpeciesSpec,growth:number,position:Readonly<Vec3>,heading:number):void {
  const m=getFishAnatomy(spec).mouth,s=getFishModelScale(spec,growth),c=Math.cos(heading),n=Math.sin(heading);
  out[0]=position[0]+s*(m[0]*c+m[2]*n);out[1]=position[1]+s*m[1];out[2]=position[2]+s*(-m[0]*n+m[2]*c);
}

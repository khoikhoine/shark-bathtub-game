import type { BagSize, Rarity, SaveV1, Tier } from '../sim/types.ts';
export const RARITIES: readonly Rarity[] = ['common','uncommon','rare','epic','legendary'];
export const RARITY: Record<Rarity, {income:number; appetite:number; sale:number; length:number}> = {
 common:{income:4,appetite:1,sale:25,length:.4}, uncommon:{income:7,appetite:1.2,sale:70,length:.5}, rare:{income:12,appetite:1.5,sale:220,length:.65}, epic:{income:20,appetite:2,sale:650,length:.85}, legendary:{income:36,appetite:2.5,sale:1800,length:1.1},
};

export interface MotionSettings {
 cruise:number; chase:number; acceleration:number; brake:number; maxYaw:number; vertical:number; beat:number;
}
/** Swimming settings are independent of economic rarity and catalog ordering. */
export const MOTION:Readonly<Record<string,Readonly<MotionSettings>>> = {
 livebearer:{cruise:.45,chase:.80,acceleration:1.6,brake:2.2,maxYaw:3.5,vertical:.32,beat:1.6},
 minnow:{cruise:.62,chase:1.05,acceleration:2.2,brake:2.8,maxYaw:4.4,vertical:.40,beat:2.2},
 goldfish:{cruise:.36,chase:.67,acceleration:1.2,brake:1.8,maxYaw:2.7,vertical:.28,beat:1.25},
 reef:{cruise:.48,chase:.85,acceleration:1.7,brake:2.2,maxYaw:3.4,vertical:.34,beat:1.6},
 gourami:{cruise:.40,chase:.72,acceleration:1.3,brake:1.9,maxYaw:3.0,vertical:.30,beat:1.35},
 flowing:{cruise:.32,chase:.64,acceleration:1.3,brake:1.8,maxYaw:3.4,vertical:.30,beat:1.5},
 tall:{cruise:.38,chase:.70,acceleration:1.25,brake:1.8,maxYaw:2.8,vertical:.28,beat:1.25},
 puffer:{cruise:.30,chase:.57,acceleration:1.4,brake:1.8,maxYaw:3.8,vertical:.28,beat:2.3},
 lionfish:{cruise:.32,chase:.62,acceleration:1.2,brake:1.8,maxYaw:2.6,vertical:.28,beat:1.1},
 shark:{cruise:.58,chase:.95,acceleration:1.5,brake:2.2,maxYaw:2.1,vertical:.30,beat:1.15},
 ray:{cruise:.43,chase:.76,acceleration:1.2,brake:1.8,maxYaw:2.2,vertical:.24,beat:.95},
 eel:{cruise:.47,chase:.84,acceleration:1.5,brake:2.1,maxYaw:3.2,vertical:.32,beat:1.4},
 seahorse:{cruise:.23,chase:.48,acceleration:1.0,brake:1.5,maxYaw:2.5,vertical:.27,beat:2.6},
};
export const MOTION_OVERRIDES:Readonly<Record<string,readonly [cruise:number,chase:number,beat:number]>> = {
 koi:[1.25,1.20,1.05],rainbowfish:[1.1,1.1,1.1],mandarin:[.70,.80,1.15],sunfish:[.75,.85,.65],
 'nurse-shark':[.80,.85,.85],'whale-shark':[.80,.85,.80],'thresher-shark':[1.1,1.1,1.1],
};
export const FOOD: Record<BagSize,{portions:number;cost:number}> = {small:{portions:10,cost:30},medium:{portions:40,cost:120},large:{portions:100,cost:300}};
export const FOOD_LIFETIME = 7200;
export const PELLET_LIFETIME = 60;
export const OFFLINE_LIMIT = 28800;
export const FIXED_DT = .05;
export const CAPACITY = [5,10,15,20,30] as const;
export const BATH_COST = [500,1800,5000,14000] as const;
export const FILTER_COST = [250,900,2500,6000] as const;
export const FILTER_POWER = [0,2,5,9,12] as const;
export const GACHA: Record<Tier,{cost:number;weights:readonly number[];ready:(save:SaveV1)=>boolean}> = {
 basic:{cost:100,weights:[85,15,0,0,0],ready:()=>true},
 standard:{cost:400,weights:[45,40,15,0,0],ready:s=>s.run.totalFed>=20},
 premium:{cost:1200,weights:[0,30,50,20,0],ready:s=>s.run.adultsRaised>=3},
 legendary:{cost:4000,weights:[0,0,35,50,15],ready:s=>s.run.bathLevel>=3&&s.discovered.length>=20},
};
export const MILESTONES: readonly {id:string;speciesId:string;ready:(save:SaveV1)=>boolean}[] = [
 {id:'fed-10',speciesId:'seahorse',ready:s=>s.run.totalFed>=10},
 {id:'raised-1',speciesId:'koi',ready:s=>s.run.adultsRaised>=1},
 {id:'raised-3',speciesId:'lionfish',ready:s=>s.run.adultsRaised>=3},
 {id:'bath-2',speciesId:'manta',ready:s=>s.run.bathLevel>=2},
 {id:'discovered-30',speciesId:'oarfish',ready:s=>s.discovered.length>=30},
];
// The eight-corner motion/SDF hot path repeatedly reads these five immutable sizes.
const WATER_BOUNDS=Array.from({length:CAPACITY.length},(_,level)=>Object.freeze({x:2.2+.35*level,z:1+.08*level}));
export function waterBounds(level:number): {x:number;z:number} {return WATER_BOUNDS[level]??{x:2.2+.35*level,z:1+.08*level};}

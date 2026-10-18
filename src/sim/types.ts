export type Locale = 'vi' | 'en';
export type Vec3 = [number, number, number];
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Gate = 'none' | 'raised-1' | 'raised-3' | 'raised-6' | 'filter-2' | 'bath-3' | 'bath-max';
export interface SpeciesSpec {
  id: string; index: number; name: Record<Locale, string>; rarity: Rarity;
  family: string; signature: Record<Locale, string>; colors: [string, string, string];
  acquisition: 'gacha' | 'milestone' | 'starter-and-gacha'; gate: Gate;
}
export interface FishState {
  id: string; speciesId: string; growth: number; hunger: number; starvingSeconds: number;
  coinCredit: number; dropSeconds: number; position: Vec3; heading: number; phase: number;
}
export interface FishPose {
  x:number; y:number; z:number; heading:number; phase:number; growth:number; atActiveSeconds:number;
}
export interface FoodBag { id: string; remaining: number; expiresAtActiveSeconds: number }
export interface Pellet { id: string; position: Vec3; ttlSeconds: number }
export interface RunState {
  id: string; wallet: number; pendingCoins: number; activeSeconds: number; resumeGraceSeconds: number;
  fish: FishState[]; foodBags: FoodBag[]; pellets: Pellet[]; dirt: number[];
  bathLevel: number; filterLevel: number; totalFed: number; adultsRaised: number;
  claimedMilestones: string[]; rngState: number; nextId: number;
}
export interface SaveV1 {
  version: 1; savedAtMs: number; settings: { language: Locale; muted: boolean };
  discovered: string[]; run: RunState;
}
export type Tier = 'basic' | 'standard' | 'premium' | 'legendary';
export type BagSize = 'small' | 'medium' | 'large';
export type GameAction =
  | { type: 'buy-food'; size: BagSize } | { type: 'drop-food'; x: number; z: number }
  | { type: 'collect-all' } | { type: 'scrub'; x: number; z: number }
  | { type: 'roll'; tier: Tier } | { type: 'sell'; fishId: string }
  | { type: 'upgrade-bath' } | { type: 'upgrade-filter' }
  | { type: 'claim-milestone'; milestoneId: string };
export type ActionError = 'insufficient-coins' | 'no-food' | 'full-bath' | 'locked' | 'unknown-fish' | 'already-claimed' | 'not-ready' | 'max-level' | 'outside-water';
export type GameEvent =
  | { type: 'coin-drop'; fishId: string; amount: number }
  | { type: 'fish-grown' | 'fish-left' | 'fish-acquired' | 'fish-sold'; fishId: string; speciesId: string; amount?: number }
  | { type: 'food-expired'; bagId: string; amount: number }
  | { type: 'milestone-ready'; milestoneId: string };
export type ActionResult = { ok: true; events: GameEvent[] } | { ok: false; code: ActionError };
export type Mode = 'inspect' | 'feed' | 'scrub';
export type WaterPointerSample =
  | {phase:'start'|'move';x:number;z:number}
  | {phase:'end'|'cancel'};
export interface SceneFeedback {
  hoveredFishId:string|null;
  target:'none'|'valid'|'outside-water'|'no-food';
  feeding:boolean;
  dropped:number;
}

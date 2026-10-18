import { species, SPECIES } from '../data/catalog.ts';
import { CAPACITY, FOOD_LIFETIME, MILESTONES, OFFLINE_LIMIT, PELLET_LIFETIME, waterBounds } from '../data/balance.ts';
import { getCleanliness, getFishStats, getIncomePerMinute } from '../sim/engine.ts';
import type { SaveV1 } from '../sim/types.ts';
import { WATER_Y } from '../sim/water.ts';

export const SAVE_KEY = 'bathtub-aquarium.save.v1';
const MAX_BYTES = 1024 * 1024;
export type SaveDecodeCode = 'invalid-json' | 'unsupported-version' | 'invalid-save' | 'file-too-large';

export class SaveDecodeError extends Error {
  readonly code: SaveDecodeCode;
  readonly field: string;
  constructor(code: SaveDecodeCode, field = '') {
    super(field ? `${code}: ${field}` : code);
    this.name = 'SaveDecodeError';
    this.code = code;
    this.field = field;
  }
}

function invalid(field: string): never { throw new SaveDecodeError('invalid-save', field); }
function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}
function number(value: unknown, field: string, min = 0, max = Number.MAX_VALUE, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid(field);
  return value;
}
function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return number(value, field, min, max, true);
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(field);
  return value;
}
function stringSet(value: unknown, field: string, allowed: (id: string) => boolean): string[] {
  const seen = new Set<string>();
  return array(value, field).map((entry, i) => {
    const id = text(entry, `${field}[${i}]`);
    if (!allowed(id) || seen.has(id)) invalid(`${field}[${i}]`);
    seen.add(id);
    return id;
  });
}

/** Validate the entire document before exposing any portion to the controller. */
function validate(value: unknown): SaveV1 {
  const save = object(value, 'save');
  if (save.version !== 1) throw new SaveDecodeError('unsupported-version');
  number(save.savedAtMs, 'savedAtMs');
  const settings = object(save.settings, 'settings');
  if (settings.language !== 'vi' && settings.language !== 'en') invalid('settings.language');
  if (typeof settings.muted !== 'boolean') invalid('settings.muted');
  const discovered = stringSet(save.discovered, 'discovered', id => Object.hasOwn(SPECIES,id));
  const ownedSpecies = new Set(discovered);
  const run = object(save.run, 'run');
  text(run.id, 'run.id');
  integer(run.wallet, 'run.wallet');
  integer(run.pendingCoins, 'run.pendingCoins');
  const active = number(run.activeSeconds, 'run.activeSeconds');
  number(run.resumeGraceSeconds, 'run.resumeGraceSeconds', 0, 60);
  const level = integer(run.bathLevel, 'run.bathLevel', 0, 4);
  integer(run.filterLevel, 'run.filterLevel', 0, 4);
  integer(run.totalFed, 'run.totalFed');
  integer(run.adultsRaised, 'run.adultsRaised');
  integer(run.rngState, 'run.rngState', 1, 0xffffffff);
  integer(run.nextId, 'run.nextId', 1);
  stringSet(run.claimedMilestones, 'run.claimedMilestones', id => MILESTONES.some(milestone => milestone.id === id));
  const dirt = array(run.dirt, 'run.dirt');
  if (dirt.length !== 20) invalid('run.dirt');
  dirt.forEach((entry, i) => number(entry, `run.dirt[${i}]`, 0, 1));
  const bounds = waterBounds(level);
  const ids = new Set<string>();
  function entity(value: unknown, field: string): Record<string, unknown> {
    const result = object(value, field);
    const id = text(result.id, `${field}.id`);
    if (ids.has(id)) invalid(`${field}.id`);
    ids.add(id);
    return result;
  }
  function position(value: unknown, field: string, maxY: number): void {
    const point = array(value, field);
    if (point.length !== 3) invalid(field);
    number(point[0], `${field}[0]`, -bounds.x, bounds.x);
    number(point[1], `${field}[1]`, -0.15, maxY);
    number(point[2], `${field}[2]`, -bounds.z, bounds.z);
  }
  const fish = array(run.fish, 'run.fish');
  if (fish.length > CAPACITY[level]! || fish.length > 30) invalid('run.fish');
  fish.forEach((entry, i) => {
    const path = `run.fish[${i}]`;
    const item = entity(entry, path);
    const speciesId = text(item.speciesId, `${path}.speciesId`);
    if (!Object.hasOwn(SPECIES,speciesId) || !ownedSpecies.has(speciesId)) invalid(`${path}.speciesId`);
    number(item.growth, `${path}.growth`, 0, 1);
    number(item.hunger, `${path}.hunger`, 0, 100);
    number(item.starvingSeconds, `${path}.starvingSeconds`, 0, 180);
    number(item.coinCredit, `${path}.coinCredit`);
    const dropSeconds = number(item.dropSeconds, `${path}.dropSeconds`, 0, 20);
    if (dropSeconds === 20) invalid(`${path}.dropSeconds`);
    number(item.heading, `${path}.heading`, -Number.MAX_VALUE);
    number(item.phase, `${path}.phase`, -Number.MAX_VALUE);
    position(item.position, `${path}.position`, 0.9);
  });
  array(run.foodBags, 'run.foodBags').forEach((entry, i) => {
    const path = `run.foodBags[${i}]`;
    const item = entity(entry, path);
    integer(item.remaining, `${path}.remaining`, 0, 100);
    number(item.expiresAtActiveSeconds, `${path}.expiresAtActiveSeconds`, 0, active + FOOD_LIFETIME);
  });
  array(run.pellets, 'run.pellets').forEach((entry, i) => {
    const path = `run.pellets[${i}]`;
    const item = entity(entry, path);
    number(item.ttlSeconds, `${path}.ttlSeconds`, 0, PELLET_LIFETIME);
    position(item.position, `${path}.position`, WATER_Y);
  });
  return value as SaveV1;
}

export function encodeSave(save: SaveV1): string {
  validate(save);
  const text = JSON.stringify(save);
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new SaveDecodeError('file-too-large');
  return text;
}

export function decodeSave(text: string): SaveV1 {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new SaveDecodeError('file-too-large');
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw new SaveDecodeError('invalid-json'); }
  return validate(parsed);
}

export function reconcileOffline(save: SaveV1, nowMs: number): { save: SaveV1; summary: { seconds: number; coins: number; adults: number } } {
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite');
  const next = structuredClone(save);
  const seconds = Math.min(OFFLINE_LIMIT, Math.max(0, (nowMs - save.savedAtMs) / 1000));
  const run = next.run;
  const cleanlinessFactor = 0.5 + 0.5 * getCleanliness(run) / 100;
  let coins = 0;
  let adults = 0;
  for (const fish of run.fish) {
    const spec = species(fish.speciesId);
    const growthStart = fish.growth;
    const growthRate = Math.min(1, fish.hunger / 30) * cleanlinessFactor / getFishStats(spec, growthStart).growthSeconds;
    const maturitySeconds = growthRate > 0 ? (1 - growthStart) / growthRate : Infinity;
    const growingSeconds = growthStart < 1 ? Math.min(seconds, maturitySeconds) : 0;
    const growthEnd = seconds >= maturitySeconds ? 1 : Math.min(1, growthStart + growthRate * growingSeconds);
    // Income is affine in growth; trapezoid integration is exact until maturity.
    const initialRate = getIncomePerMinute(run, fish);
    fish.growth = growthEnd;
    const finalRate = getIncomePerMinute(run, fish);
    const income = ((initialRate + finalRate) * 0.5 * growingSeconds + finalRate * (seconds - growingSeconds)) / 60;
    const credit = fish.coinCredit + income;
    const whole = Math.floor(credit);
    fish.coinCredit = credit - whole;
    run.pendingCoins += whole;
    coins += whole;
    if (growthStart < 1 && growthEnd === 1) {
      run.adultsRaised++;
      adults++;
    }
  }
  run.resumeGraceSeconds = 60;
  next.savedAtMs = Math.max(0, nowMs);
  return { save: next, summary: { seconds, coins, adults } };
}

export function loadStoredSave(): string | null { return localStorage.getItem(SAVE_KEY); }
export function storeSave(text: string): void { localStorage.setItem(SAVE_KEY, text); }

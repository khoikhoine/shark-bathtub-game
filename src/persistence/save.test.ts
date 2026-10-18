import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getFishStats, getIncomePerMinute, getPreviousFishPose, resetRunRuntime, step } from '../sim/engine.ts';
import { species } from '../data/catalog.ts';
import { decodeSave, encodeSave, loadStoredSave, reconcileOffline, SAVE_KEY, SaveDecodeError, storeSave } from './save.ts';
import type { SaveDecodeCode } from './save.ts';
import type { SaveV1 } from '../sim/types.ts';
import { isInsideWater } from '../sim/water.ts';
import { waterBounds } from '../data/balance.ts';

const NOW = 1_800_000_000_000;
function fresh(): SaveV1 { return createGame(NOW, 123456); }
function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}
function rejected(value: unknown, code: SaveDecodeCode = 'invalid-save'): void {
  assert.throws(() => decodeSave(JSON.stringify(value)), (error: unknown) => error instanceof SaveDecodeError && error.code === code);
}

test('ten hours offline awards only eight hours and freezes every care clock', () => {
  const original = fresh();
  original.run.fish[0]!.hunger = 0;
  original.run.fish[0]!.starvingSeconds = 179;
  original.run.activeSeconds = 125;
  original.run.foodBags[0]!.expiresAtActiveSeconds = 126;
  original.run.pellets.push({ id: 'offline-pellet', position: [0, 1.1, 0], ttlSeconds: 12 });
  const before = structuredClone(original);
  const result = reconcileOffline(original, NOW + 10 * 3600 * 1000);
  assert.equal(result.summary.seconds, 8 * 3600);
  assert.equal(result.save.savedAtMs, NOW + 10 * 3600 * 1000);
  assert.equal(result.save.run.resumeGraceSeconds, 60);
  assert.equal(result.save.run.activeSeconds, before.run.activeSeconds);
  assert.equal(result.save.run.filterLevel, before.run.filterLevel);
  assert.deepEqual(result.save.run.foodBags, before.run.foodBags);
  assert.deepEqual(result.save.run.pellets, before.run.pellets);
  assert.deepEqual(result.save.run.dirt, before.run.dirt);
  assert.deepEqual(result.save.run.fish.map(f => [f.id, f.hunger, f.starvingSeconds, f.position, f.heading, f.phase, f.dropSeconds]), before.run.fish.map(f => [f.id, f.hunger, f.starvingSeconds, f.position, f.heading, f.phase, f.dropSeconds]));
  assert.equal(result.save.run.fish.length, before.run.fish.length);
  assert.deepEqual(original, before, 'reconciliation must not mutate the current save before controller replacement');
});

test('adult income integrates the full capped duration and preserves fractional credit', () => {
  const save = fresh();
  save.run.fish = [save.run.fish[0]!];
  const fish = save.run.fish[0]!;
  fish.growth = 1;
  fish.hunger = 15;
  fish.coinCredit = 0.25;
  const rate = getIncomePerMinute(save.run, fish);
  const expected = rate * 480 + 0.25;
  const result = reconcileOffline(save, NOW + 10 * 3600 * 1000);
  assert.equal(result.summary.coins, Math.floor(expected));
  assert.equal(result.save.run.pendingCoins, save.run.pendingCoins + Math.floor(expected));
  close(result.save.run.fish[0]!.coinCredit, expected - Math.floor(expected));
  assert.equal(result.summary.adults, 0);
});

test('linear growth income is integrated exactly without maturity', () => {
  const save = fresh();
  save.run.fish = [save.run.fish[1]!];
  const fish = save.run.fish[0]!;
  fish.growth = 0.2;
  fish.hunger = 15;
  save.run.dirt.fill(0.4);
  const duration = 120;
  const growthSeconds = getFishStats(species(fish.speciesId), 0.2).growthSeconds;
  const endGrowth = 0.2 + duration * 0.5 * 0.8 / growthSeconds;
  const initial = getIncomePerMinute(save.run, fish);
  const final = getIncomePerMinute(save.run, { ...fish, growth: endGrowth });
  const expected = fish.coinCredit + (initial + final) / 2 * duration / 60;
  const result = reconcileOffline(save, NOW + duration * 1000);
  close(result.save.run.fish[0]!.growth, endGrowth);
  assert.equal(result.summary.coins, Math.floor(expected));
  close(result.save.run.fish[0]!.coinCredit, expected - Math.floor(expected));
  assert.equal(result.summary.adults, 0);
});

test('income splits at maturity and counts each new adult once', () => {
  const save = fresh();
  save.run.fish = [save.run.fish[1]!];
  const fish = save.run.fish[0]!;
  fish.growth = 0.95;
  fish.hunger = 100;
  save.run.dirt.fill(0);
  const growthSeconds = getFishStats(species(fish.speciesId), fish.growth).growthSeconds;
  const toAdult = (1 - fish.growth) * growthSeconds;
  const seconds = toAdult + 600;
  const initial = getIncomePerMinute(save.run, fish);
  const adult = getIncomePerMinute(save.run, { ...fish, growth: 1 });
  const expected = fish.coinCredit + ((initial + adult) / 2 * toAdult + adult * 600) / 60;
  const result = reconcileOffline(save, NOW + seconds * 1000);
  assert.equal(result.save.run.fish[0]!.growth, 1);
  assert.equal(result.summary.adults, 1);
  assert.equal(result.save.run.adultsRaised, save.run.adultsRaised + 1);
  assert.equal(result.summary.coins, Math.floor(expected));
  close(result.save.run.fish[0]!.coinCredit, expected - Math.floor(expected));
  const again = reconcileOffline(result.save, result.save.savedAtMs + 60_000);
  assert.equal(again.summary.adults, 0);
  assert.equal(again.save.run.adultsRaised, result.save.run.adultsRaised);
});

test('hunger zero grants no growth or income and cannot cause offline departure', () => {
  const save = fresh();
  for (const fish of save.run.fish) {
    fish.hunger = 0;
    fish.starvingSeconds = 179;
    fish.coinCredit = 0;
  }
  const result = reconcileOffline(save, NOW + 28_800_000);
  assert.equal(result.summary.coins, 0);
  assert.equal(result.summary.adults, 0);
  assert.deepEqual(result.save.run.fish, save.run.fish);
});

test('reconciling the same timestamp twice cannot duplicate income or adults', () => {
  const first = reconcileOffline(fresh(), NOW + 28_800_000);
  const second = reconcileOffline(first.save, first.save.savedAtMs);
  assert.deepEqual(second.summary, { seconds: 0, coins: 0, adults: 0 });
  assert.deepEqual(second.save, first.save);
});

test('clock rollback awards no negative income and records the new timestamp', () => {
  const save = fresh();
  const result = reconcileOffline(save, NOW - 1000);
  assert.deepEqual(result.summary, { seconds: 0, coins: 0, adults: 0 });
  assert.equal(result.save.savedAtMs, NOW - 1000);
  assert.deepEqual(result.save.run.fish, save.run.fish);
  assert.equal(result.save.run.pendingCoins, save.run.pendingCoins);
  assert.equal(result.save.run.resumeGraceSeconds, 60);
  assert.equal(reconcileOffline(save, -1000).save.savedAtMs, 0);
});

test('JSON export round trip preserves individual inventory, pellets and fish credits', () => {
  const save = fresh();
  save.settings = { language: 'en', muted: true };
  save.run.pendingCoins = 473;
  save.run.fish[0]!.coinCredit = 2.75;
  save.run.fish[0]!.dropSeconds = 19.95;
  save.run.activeSeconds = 250;
  save.run.foodBags.push({ id: 'second-bag', remaining: 39, expiresAtActiveSeconds: 7450 });
  save.run.pellets.push({ id: 'saved-pellet', position: [1, 0.7, -0.5], ttlSeconds: 23.5 });
  assert.deepEqual(decodeSave(encodeSave(save)), save);
});

test('legacy rectangular corner poses decode unchanged and recover without teleporting', () => {
  for (const level of [0, 2, 4]) {
    const save = fresh();
    save.run.bathLevel = level;
    save.run.fish = [save.run.fish[0]!];
    const bounds = waterBounds(level);
    const fish = save.run.fish[0]!;
    fish.id = 'legacy-corner-fish';
    fish.position = [bounds.x - .01, .9, bounds.z - .01];
    fish.heading = Math.PI / 4;
    fish.coinCredit = .375;
    save.run.pellets = [{ id: 'legacy-corner-pellet', position: [bounds.x - .01, .9, bounds.z - .01], ttlSeconds: 30 }];
    assert.equal(isInsideWater(level, fish.position[0], fish.position[2]), false);
    const before = structuredClone(save);
    const decoded = decodeSave(encodeSave(save));
    assert.deepEqual(decoded, before, 'decoding cannot project valid legacy poses into the new inset');
    const loaded = decoded.run.fish[0]!;
    const start = [...loaded.position];
    step(decoded.run, .05);
    assert.ok(Math.hypot(...loaded.position.map((v, i) => v - start[i])) <= 1.12 * .05 + 1e-6, 'first tick must be bounded by the maximum chase speed, not an inset snap');
    for (let tick = 1; tick < 400; tick++) {
      step(decoded.run, .05);
      assert.ok(Math.abs(loaded.position[0]) <= bounds.x && Math.abs(loaded.position[2]) <= bounds.z);
      assert.ok(loaded.position[1] >= -.15 && loaded.position[1] <= .9);
    }
    assert.equal(isInsideWater(level, loaded.position[0], loaded.position[2]), true, 'legacy corner fish must eventually recover into rounded water');
    assert.deepEqual(save, before, 'simulating the decoded object cannot mutate the source save');
  }
});

test('import with identical run ID and timestamp never inherits another object motion history', () => {
  const live = fresh();
  step(live.run, .05);
  step(live.run, .05);
  const previous = structuredClone(getPreviousFishPose(live.run, live.run.fish[0]!));
  const candidate = structuredClone(live);
  candidate.run.fish[0]!.position = [.4, .3, -.2];
  const imported = decodeSave(encodeSave(candidate));
  const fish = imported.run.fish[0]!;
  assert.equal(imported.run.id, live.run.id);
  assert.equal(imported.run.activeSeconds, live.run.activeSeconds);
  assert.deepEqual(getPreviousFishPose(imported.run, fish), {
    x: .4, y: .3, z: -.2, heading: fish.heading, phase: fish.phase,
    growth: fish.growth, atActiveSeconds: imported.run.activeSeconds,
  });
  assert.deepEqual(getPreviousFishPose(live.run, live.run.fish[0]!), previous);
  const snapshot = structuredClone(imported);
  resetRunRuntime(live.run);
  assert.deepEqual(imported, snapshot);
  assert.equal(getPreviousFishPose(imported.run, fish).x, .4);
});

test('malformed JSON, unknown versions and oversized UTF-8 documents expose translatable errors', () => {
  assert.throws(() => decodeSave('{'), (error: unknown) => error instanceof SaveDecodeError && error.code === 'invalid-json');
  rejected({ ...fresh(), version: 2 }, 'unsupported-version');
  assert.throws(() => decodeSave(' '.repeat(1024 * 1024 + 1)), (error: unknown) => error instanceof SaveDecodeError && error.code === 'file-too-large');
  assert.throws(() => decodeSave(JSON.stringify({ text: 'á'.repeat(524288) })), (error: unknown) => error instanceof SaveDecodeError && error.code === 'file-too-large');
});

test('rejects invalid species, discovery and milestone identifiers without changing the live save', () => {
  const current = fresh();
  const before = structuredClone(current);
  const mutations: ((save: SaveV1) => void)[] = [
    save => { save.run.fish[0]!.speciesId = 'unknown-species'; },
    save => { save.discovered = []; },
    save => { save.discovered.push('unknown-species'); },
    save => { save.discovered.push(save.discovered[0]!); },
    save => { save.run.claimedMilestones = ['unknown-milestone']; },
    save => { save.run.claimedMilestones = ['fed-10', 'fed-10']; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(current);
    mutate(candidate);
    rejected(candidate);
    assert.deepEqual(current, before);
  }
});

test('entity IDs are unique within and across fish, bag and pellet arrays', () => {
  const save = fresh();
  save.run.fish[1]!.id = save.run.fish[0]!.id;
  rejected(save);
  const cross = fresh();
  cross.run.foodBags[0]!.id = cross.run.fish[0]!.id;
  rejected(cross);
  const pellet = fresh();
  pellet.run.pellets.push({ id: pellet.run.foodBags[0]!.id, position: [0, 0.5, 0], ttlSeconds: 10 });
  rejected(pellet);
});

test('rejects negative, fractional, missing, nonfinite and out-of-range business fields', () => {
  const mutations: ((save: SaveV1) => void)[] = [
    save => { save.run.wallet = -1; },
    save => { save.run.pendingCoins = 0.5; },
    save => { save.run.wallet = Number.MAX_SAFE_INTEGER + 1; },
    save => { save.savedAtMs = -1; },
    save => { save.run.activeSeconds = NaN; },
    save => { save.run.resumeGraceSeconds = 61; },
    save => { save.run.bathLevel = 5; },
    save => { save.run.filterLevel = 1.5; },
    save => { save.run.totalFed = -1; },
    save => { save.run.adultsRaised = -1; },
    save => { save.run.rngState = 0; },
    save => { save.run.rngState = 0x100000000; },
    save => { save.run.nextId = 0; },
    save => { save.run.dirt.pop(); },
    save => { save.run.dirt[0] = 1.01; },
    save => { save.run.fish[0]!.growth = 1.01; },
    save => { save.run.fish[0]!.hunger = 101; },
    save => { save.run.fish[0]!.starvingSeconds = -1; },
    save => { save.run.fish[0]!.coinCredit = -1; },
    save => { save.run.fish[0]!.dropSeconds = 20; },
    save => { save.run.fish[0]!.position[0] = 999; },
    save => { save.run.fish[0]!.position[1] = 1; },
    save => { save.run.fish[0]!.heading = Infinity; },
    save => { save.run.foodBags[0]!.remaining = -1; },
    save => { save.run.foodBags[0]!.remaining = 101; },
    save => { save.run.foodBags[0]!.expiresAtActiveSeconds = 7201; },
    save => { save.run.pellets.push({ id: 'bad-pellet', position: [0, 0.5, 0], ttlSeconds: 61 }); },
  ];
  for (const mutate of mutations) {
    const save = fresh();
    mutate(save);
    rejected(save);
  }
  const missing = JSON.parse(encodeSave(fresh())) as Record<string, unknown>;
  delete missing.settings;
  rejected(missing);
  rejected(null);
  rejected([]);
});

test('rejects owned fish beyond the current capacity and accepts thirty at max level', () => {
  const save = fresh();
  const template = save.run.fish[0]!;
  save.run.fish = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(template), id: `capacity-fish-${index}` }));
  rejected(save);
  save.run.bathLevel = 4;
  save.run.fish = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(template), id: `capacity-fish-${index}` }));
  assert.equal(decodeSave(encodeSave(save)).run.fish.length, 30);
  save.run.fish.push({ ...structuredClone(template), id: 'capacity-fish-30' });
  rejected(save);
});

test('browser adapter uses one storage key and propagates access and quota failures', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string): string | null { return entries[key] ?? null; },
      setItem(key: string, value: string): void { entries[key] = value; },
    },
  });
  try {
    assert.equal(loadStoredSave(), null);
    const encoded = encodeSave(fresh());
    storeSave(encoded);
    assert.equal(entries[SAVE_KEY], encoded);
    assert.equal(loadStoredSave(), encoded);
    assert.deepEqual(Object.keys(entries), [SAVE_KEY]);
    const failure = new Error('storage unavailable');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get(): never { throw failure; },
    });
    assert.throws(() => loadStoredSave(), error => error === failure);
    assert.throws(() => storeSave(encoded), error => error === failure);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { setItem(): never { throw failure; } },
    });
    assert.throws(() => storeSave(encoded), error => error === failure);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

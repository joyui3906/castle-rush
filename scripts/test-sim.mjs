import assert from 'node:assert/strict';
import { GAME_DATA } from '../src/data/game-data.js';
import {
  createInitialState,
  enqueueCommand,
  processCommandQueue,
  tick,
} from '../src/core/sim.js';

function cloneData() {
  return JSON.parse(JSON.stringify(GAME_DATA));
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest('build command uses slot and costs gold', () => {
  const data = cloneData();
  const state = createInitialState(data);
  const beforeGold = state.castles.left.gold;

  enqueueCommand(state, {
    type: 'build',
    payload: { side: 'left', slotIndex: 0, buildingTypeId: 'barracks' },
  });
  processCommandQueue(state, data);

  const slot = state.castles.left.slots[0];
  assert.equal(slot.buildingTypeId, 'barracks');
  assert.equal(slot.buildingHp, data.buildingTypes.barracks.maxHp);
  assert.equal(state.castles.left.gold, beforeGold - data.buildingTypes.barracks.cost);
});

runTest('sell command refunds and clears slot', () => {
  const data = cloneData();
  const state = createInitialState(data);

  enqueueCommand(state, {
    type: 'build',
    payload: { side: 'left', slotIndex: 0, buildingTypeId: 'income_mine' },
  });
  processCommandQueue(state, data);
  const afterBuildGold = state.castles.left.gold;

  enqueueCommand(state, {
    type: 'sell',
    payload: { side: 'left', slotIndex: 0 },
  });
  processCommandQueue(state, data);

  const slot = state.castles.left.slots[0];
  const expectedRefund = Math.floor(data.buildingTypes.income_mine.cost * data.goldIncome.sellRefundRatio);
  assert.equal(slot.buildingTypeId, null);
  assert.equal(slot.buildingHp, 0);
  assert.equal(state.castles.left.gold, afterBuildGold + expectedRefund);
});

runTest('spawned unit starts from building x position', () => {
  const data = cloneData();
  data.config.simVariant = 0;
  const state = createInitialState(data);
  const slot = state.castles.left.slots[0];

  enqueueCommand(state, {
    type: 'build',
    payload: { side: 'left', slotIndex: slot.index, buildingTypeId: 'barracks' },
  });
  processCommandQueue(state, data);

  for (let i = 0; i < 20; i += 1) {
    tick(state, data);
    const spawned = state.battleLane.unitIds
      .map((id) => state.units[id])
      .find((unit) => unit?.side === 'left');
    if (!spawned) continue;

    assert.ok(spawned.position >= slot.x);
    assert.ok(spawned.position <= slot.x + data.unitTypes.swordsman.speed + 0.01);
    assert.ok(Math.abs(spawned.y - slot.y) <= (data.combat.movement.spawnSpread + 0.01));
    return;
  }

  assert.fail('No left unit spawned within 20 ticks');
});

runTest('unit can destroy enemy building', () => {
  const data = cloneData();
  const state = createInitialState(data);

  const targetSlot = state.castles.right.slots[0];
  targetSlot.buildingTypeId = 'income_mine';
  targetSlot.buildingHp = 10;
  targetSlot.x = 50;
  targetSlot.y = 0;

  state.units.u1 = {
    id: 'u1',
    side: 'left',
    typeId: 'test',
    hp: 100,
    maxHp: 100,
    attack: 20,
    range: 100,
    speed: 0,
    splashRadius: 0,
    splashRatio: 0,
    position: 50,
    y: 0,
    blockedTicks: 0,
    sidestepCooldown: 0,
  };
  state.battleLane.unitIds.push('u1');

  tick(state, data);

  assert.equal(targetSlot.buildingTypeId, null);
  assert.equal(targetSlot.buildingHp, 0);
});

console.log('All tests passed');

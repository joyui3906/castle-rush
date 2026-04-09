import { GAME_DATA } from '../src/data/game-data.js';
import { createInitialState, tick } from '../src/core/sim.js';

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function runScenarioOnce(label, mutateData, simVariant) {
  const data = cloneData(GAME_DATA);
  data.config.simVariant = simVariant;
  if (mutateData) mutateData(data);

  const state = createInitialState(data);
  while (!state.winner) {
    tick(state, data);
  }

  const leftBuiltSlots = (state.castles.left.slots ?? []).filter((slot) => slot.buildingTypeId).length;
  const rightBuiltSlots = (state.castles.right.slots ?? []).filter((slot) => slot.buildingTypeId).length;

  return {
    label,
    simVariant,
    winner: state.winner,
    tick: state.tick,
    leftHp: Math.max(0, state.castles.left.hp),
    rightHp: Math.max(0, state.castles.right.hp),
    unitsSpawned: state.nextUnitId - 1,
    leftBuiltSlots,
    rightBuiltSlots,
  };
}

function aggregateScenario(label, mutateData, runs = 30) {
  const results = [];
  for (let simVariant = 0; simVariant < runs; simVariant += 1) {
    results.push(runScenarioOnce(label, mutateData, simVariant));
  }

  const winnerCounts = {
    left: 0,
    right: 0,
    draw: 0,
  };
  for (const result of results) {
    winnerCounts[result.winner] += 1;
  }

  const avg = (selector) => (results.reduce((sum, result) => sum + selector(result), 0) / results.length);

  return {
    label,
    runs,
    leftWinRate: (winnerCounts.left / runs).toFixed(2),
    rightWinRate: (winnerCounts.right / runs).toFixed(2),
    drawRate: (winnerCounts.draw / runs).toFixed(2),
    avgTick: avg((r) => r.tick).toFixed(1),
    avgUnitsSpawned: avg((r) => r.unitsSpawned).toFixed(1),
    avgLeftHp: avg((r) => r.leftHp).toFixed(1),
    avgRightHp: avg((r) => r.rightHp).toFixed(1),
    avgLeftBuiltSlots: avg((r) => r.leftBuiltSlots).toFixed(1),
    avgRightBuiltSlots: avg((r) => r.rightBuiltSlots).toFixed(1),
  };
}

const scenarioDefs = [
  ['baseline_empty_start', null],
  ['left_aggressive_opening', (data) => {
    data.castles.left.startingBuildings = ['income_mine', 'barracks', 'tank_forge'];
  }],
  ['right_aggressive_opening', (data) => {
    data.castles.right.startingBuildings = ['income_mine', 'barracks', 'tank_forge'];
  }],
  ['no_comeback_or_defense', (data) => {
    data.combat.comebackSpawn.enabled = false;
    data.combat.castleDefenseBonus.enabled = false;
  }],
];

const aggregates = scenarioDefs.map(([label, mutateData]) => aggregateScenario(label, mutateData, 30));
console.table(aggregates);

import assert from 'node:assert/strict';
import { GAME_DATA } from '../src/data/game-data.js';
import {
  createMatch,
  joinMatch,
  setPlayerReady,
  enqueuePlayerCommand,
  advanceMatchTick,
  createMatchSnapshot,
} from '../src/core/match.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest('players can join left/right', () => {
  const match = createMatch({ data: GAME_DATA });
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(joinMatch(match, 'p2'), 'right');
  assert.equal(joinMatch(match, 'p3'), null);
});

runTest('match starts when both ready', () => {
  const match = createMatch({ data: GAME_DATA });
  joinMatch(match, 'p1');
  joinMatch(match, 'p2');
  assert.equal(match.status, 'waiting');
  setPlayerReady(match, 'p1', true);
  assert.equal(match.status, 'waiting');
  setPlayerReady(match, 'p2', true);
  assert.equal(match.status, 'running');
});

runTest('side spoofed command is rejected', () => {
  const match = createMatch({ data: GAME_DATA });
  joinMatch(match, 'p1');
  joinMatch(match, 'p2');
  setPlayerReady(match, 'p1', true);
  setPlayerReady(match, 'p2', true);

  const accepted = enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'right', buildingTypeId: 'barracks', slotIndex: 0 },
  }, 1);
  assert.equal(accepted, false);
});

runTest('accepted commands are applied on server tick', () => {
  const match = createMatch({ data: GAME_DATA });
  joinMatch(match, 'p1');
  joinMatch(match, 'p2');
  setPlayerReady(match, 'p1', true);
  setPlayerReady(match, 'p2', true);

  const accepted = enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
  }, 1);
  assert.equal(accepted, true);

  advanceMatchTick(match);
  assert.equal(match.state.castles.left.slots[0].buildingTypeId, 'barracks');
  assert.equal(match.serverTick, 1);
});

runTest('out-of-order sequence is rejected', () => {
  const match = createMatch({ data: GAME_DATA });
  joinMatch(match, 'p1');
  joinMatch(match, 'p2');
  setPlayerReady(match, 'p1', true);
  setPlayerReady(match, 'p2', true);

  assert.equal(enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
  }, 2), true);

  assert.equal(enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'range_tower', slotIndex: 1 },
  }, 1), false);
});

runTest('snapshot exposes minimal match info', () => {
  const match = createMatch({ data: GAME_DATA });
  joinMatch(match, 'p1');
  joinMatch(match, 'p2');
  const snapshot = createMatchSnapshot(match);

  assert.equal(snapshot.players.left.playerId, 'p1');
  assert.equal(snapshot.players.right.playerId, 'p2');
  assert.equal(snapshot.status, 'waiting');
});

console.log('All match tests passed');

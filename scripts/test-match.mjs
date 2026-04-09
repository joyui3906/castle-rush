import assert from 'node:assert/strict';
import { GAME_DATA } from '../src/data/game-data.js';
import {
  createMatch,
  joinMatch,
  setPlayerReady,
  disconnectPlayer,
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

runTest('third player is rejected when match is full', () => {
  const match = createMatch({ data: GAME_DATA });
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(joinMatch(match, 'p2'), 'right');
  assert.equal(joinMatch(match, 'p3'), null);
});

runTest('disconnected player keeps side and prevents third player join', () => {
  const match = createMatch({ data: GAME_DATA });
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(joinMatch(match, 'p2'), 'right');
  assert.equal(disconnectPlayer(match, 'p1'), true);
  assert.equal(match.players.left.connected, false);
  assert.equal(disconnectPlayer(match, 'p1'), true);
  assert.equal(joinMatch(match, 'p3'), null);
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(match.players.left.connected, true);
});

runTest('commands are rejected before match starts', () => {
  const match = createMatch({ data: GAME_DATA });
  joinMatch(match, 'p1');
  joinMatch(match, 'p2');
  const accepted = enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
  }, 1);
  assert.equal(accepted, false);
});

runTest('commands from unknown player are rejected', () => {
  const match = createMatch({ data: GAME_DATA });
  joinMatch(match, 'p1');
  joinMatch(match, 'p2');
  setPlayerReady(match, 'p1', true);
  setPlayerReady(match, 'p2', true);
  const accepted = enqueuePlayerCommand(match, 'unknown', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
  }, 1);
  assert.equal(accepted, false);
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

runTest('rejoin restores side and keeps sequence continuity', () => {
  const match = createMatch({ data: GAME_DATA });
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(joinMatch(match, 'p2'), 'right');
  setPlayerReady(match, 'p1', true);
  setPlayerReady(match, 'p2', true);

  assert.equal(enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
  }, 1), true);

  disconnectPlayer(match, 'p1');
  assert.equal(match.players.left.connected, false);

  // Same player id rejoins and keeps left side.
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(match.players.left.connected, true);

  // Duplicate seq is idempotent-accepted (ack-loss case), but older than last is rejected.
  assert.equal(enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'range_tower', slotIndex: 1 },
  }, 1), true);
  assert.equal(enqueuePlayerCommand(match, 'p1', {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'range_tower', slotIndex: 1 },
  }, 2), true);
});

runTest('reconnect churn keeps side and sequence continuity', () => {
  const match = createMatch({ data: GAME_DATA });
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(joinMatch(match, 'p2'), 'right');
  setPlayerReady(match, 'p1', true);
  setPlayerReady(match, 'p2', true);

  const commandA = {
    type: 'build',
    payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
  };
  assert.equal(enqueuePlayerCommand(match, 'p1', commandA, 1), true);

  disconnectPlayer(match, 'p1');
  disconnectPlayer(match, 'p1');
  assert.equal(joinMatch(match, 'p1'), 'left');

  const commandB = {
    type: 'sell',
    payload: { side: 'left', slotIndex: 0 },
  };
  assert.equal(enqueuePlayerCommand(match, 'p1', commandB, 1), true);

  disconnectPlayer(match, 'p1');
  assert.equal(joinMatch(match, 'p1'), 'left');
  assert.equal(enqueuePlayerCommand(match, 'p1', commandB, 2), true);
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

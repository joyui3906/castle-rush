import { GAME_DATA } from '../src/data/game-data.js';
import {
  createMatch,
  joinMatch,
  setPlayerReady,
  enqueuePlayerCommand,
  advanceMatchTick,
  createMatchSnapshot,
} from '../src/core/match.js';

const match = createMatch({
  matchId: 'demo-1v1',
  data: GAME_DATA,
});

joinMatch(match, 'alice');
joinMatch(match, 'bob');
setPlayerReady(match, 'alice', true);
setPlayerReady(match, 'bob', true);

enqueuePlayerCommand(match, 'alice', {
  type: 'build',
  payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
}, 1);
enqueuePlayerCommand(match, 'bob', {
  type: 'build',
  payload: { side: 'right', buildingTypeId: 'barracks', slotIndex: 0 },
}, 1);

for (let i = 0; i < 40; i += 1) {
  if (i === 6) {
    enqueuePlayerCommand(match, 'alice', {
      type: 'build',
      payload: { side: 'left', buildingTypeId: 'range_tower', slotIndex: 1 },
    }, 2);
  }

  if (i === 8) {
    enqueuePlayerCommand(match, 'bob', {
      type: 'build',
      payload: { side: 'right', buildingTypeId: 'tank_forge', slotIndex: 1 },
    }, 2);
  }

  advanceMatchTick(match);
  if (match.status === 'finished') break;
}

const summary = createMatchSnapshot(match);
console.log('Match Snapshot:', summary);
console.log('Left Castle:', {
  hp: match.state.castles.left.hp,
  gold: match.state.castles.left.gold,
  builtSlots: match.state.castles.left.slots.filter((s) => s.buildingTypeId).length,
});
console.log('Right Castle:', {
  hp: match.state.castles.right.hp,
  gold: match.state.castles.right.gold,
  builtSlots: match.state.castles.right.slots.filter((s) => s.buildingTypeId).length,
});

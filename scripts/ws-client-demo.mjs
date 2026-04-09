import WebSocket from 'ws';
import { NETWORK_MESSAGE_TYPE } from '../src/net/network-messages.js';

const SERVER_URL = process.env.MATCH_URL ?? 'ws://localhost:8787';
const MATCH_ID = process.env.MATCH_ID ?? 'room-1';
const SNAPSHOT_TICKS = Number(process.env.SNAPSHOT_TICKS ?? 0);

function createClient(playerId, sideBuildSlot) {
  const ws = new WebSocket(SERVER_URL);
  let seq = 0;
  let lastSnapshotTick = 0;
  let snapshot = null;

  const state = {
    tick: 0,
    battleLane: null,
    castles: null,
    events: [],
    units: {},
    nextUnitId: 1,
  };

  const applyFullState = (remoteState) => {
    if (!remoteState) return;
    if (remoteState.tick !== undefined) state.tick = remoteState.tick;
    if (remoteState.battleLane) state.battleLane = remoteState.battleLane;
    if (remoteState.castles) state.castles = remoteState.castles;
    if (remoteState.events) state.events = remoteState.events;
    if (remoteState.units) state.units = remoteState.units;
    if (remoteState.nextUnitId !== undefined) state.nextUnitId = remoteState.nextUnitId;
    lastSnapshotTick = remoteState.tick ?? state.tick;
  };

  const applyStateDelta = (delta) => {
    if (!delta) return;
    if (delta.tick !== undefined) state.tick = delta.tick;
    if (delta.battleLane && state.battleLane) {
      state.battleLane = { ...state.battleLane, ...delta.battleLane };
    } else if (delta.battleLane) {
      state.battleLane = delta.battleLane;
    }

    if (delta.castles) {
      if (delta.castles.left) state.castles.left = delta.castles.left;
      if (delta.castles.right) state.castles.right = delta.castles.right;
    }

    if (Array.isArray(delta.events)) state.events = delta.events;

    if (delta.units) {
      if (Array.isArray(delta.units.removed)) {
        for (const unitId of delta.units.removed) {
          delete state.units[unitId];
        }
      }
      if (delta.units.changed) Object.assign(state.units, delta.units.changed);
    }

    if (delta.nextUnitId !== undefined) state.nextUnitId = delta.nextUnitId;
  };

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: NETWORK_MESSAGE_TYPE.JOIN,
      matchId: MATCH_ID,
      playerId,
    }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === NETWORK_MESSAGE_TYPE.HELLO) return;

    if (msg.type === NETWORK_MESSAGE_TYPE.JOINED) {
      console.log(`[${playerId}] joined as ${msg.side}`);
      ws.send(JSON.stringify({ type: NETWORK_MESSAGE_TYPE.READY, ready: true }));
      ws.send(JSON.stringify({
        type: NETWORK_MESSAGE_TYPE.COMMAND,
        seq: (seq += 1),
        command: {
          type: 'build',
          payload: {
            side: msg.side,
            buildingTypeId: 'barracks',
            slotIndex: sideBuildSlot,
          },
        },
      }));
      return;
    }

    if (msg.type === NETWORK_MESSAGE_TYPE.STATE) {
      if (msg.state) {
        applyFullState(msg.state);
      } else {
        applyStateDelta(msg.stateDelta);
      }

      const tick = msg.snapshot?.stateTick ?? state.tick;
      const winner = msg.snapshot?.winner ?? 'none';
      const mode = msg.state ? 'full' : 'delta';
      if (tick % 20 === 0) {
        console.log(`[${playerId}] tick=${tick} winner=${winner} (${mode})`);
      }
      snapshot = msg.snapshot ?? null;
      if (SNAPSHOT_TICKS > 0 && state.tick % SNAPSHOT_TICKS === 0 && state.tick > lastSnapshotTick) {
        ws.send(JSON.stringify({ type: NETWORK_MESSAGE_TYPE.SNAPSHOT_REQUEST }));
      }
      return;
    }

    if (msg.type === NETWORK_MESSAGE_TYPE.ERROR) {
      console.log(`[${playerId}] error: ${msg.message}`);
    }
  });

  ws.on('close', () => {
    const status = snapshot ? `lastTick=${snapshot.stateTick}` : 'unknown';
    console.log(`[${playerId}] disconnected (${status})`);
  });
}

createClient('alice', 0);
createClient('bob', 0);

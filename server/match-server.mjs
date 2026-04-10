import { WebSocketServer } from 'ws';
import { GAME_DATA } from '../src/data/game-data.js';
import {
  NETWORK_MESSAGE_TEXT,
  NETWORK_MESSAGE_TYPE,
  formatUnknownMessage,
} from '../src/net/network-messages.js';
import {
  createMatch,
  joinMatch,
  setPlayerReady,
  disconnectPlayer,
  enqueuePlayerCommand,
  advanceMatchTick,
  createMatchSnapshot,
} from '../src/core/match.js';

const PORT = Number(process.env.MATCH_PORT ?? 8787);
const TICK_INTERVAL_MS = Number(process.env.MATCH_TICK_MS ?? GAME_DATA.config.tickMs);
const MATCH_DISCONNECT_TIMEOUT_MS = Number(process.env.MATCH_DISCONNECT_TIMEOUT_MS ?? 5 * 60 * 1000);
const MATCH_CLEANUP_INTERVAL_MS = Math.max(1000, Number(process.env.MATCH_CLEANUP_INTERVAL_MS ?? 15000));
const MATCH_AUTH_TOKEN = process.env.MATCH_AUTH_TOKEN ?? '';
const FULL_STATE_EVERY_TICKS = Math.max(
  1,
  Number(process.env.MATCH_FULL_STATE_EVERY_TICKS ?? 12),
);

function cloneForTransport(data) {
  return JSON.parse(JSON.stringify(data));
}

function isDeepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function extractState(match) {
  return {
    tick: match.state.tick,
    timeMs: match.state.timeMs,
    winner: match.state.winner,
    castles: match.state.castles,
    battleLane: match.state.battleLane,
    events: match.state.events,
    units: match.state.units,
    nextUnitId: match.state.nextUnitId,
    nukeEffect: match.state.ui?.nukeEffect ?? null,
    nukeUsed: match.state.ui?.nukeUsed ?? { left: false, right: false },
  };
}

function diffMatchState(previous, next) {
  if (!previous) {
    return next;
  }

  const delta = {};
  if (previous.tick !== next.tick) {
    delta.tick = next.tick;
  }
  if (previous.timeMs !== next.timeMs) {
    delta.timeMs = next.timeMs;
  }
  if (previous.winner !== next.winner) {
    delta.winner = next.winner;
  }

  if (!isDeepEqual(previous.castles?.left, next.castles?.left) || !isDeepEqual(previous.castles?.right, next.castles?.right)) {
    const changedCastles = {};
    if (!isDeepEqual(previous.castles?.left, next.castles?.left)) {
      changedCastles.left = next.castles.left;
    }
    if (!isDeepEqual(previous.castles?.right, next.castles?.right)) {
      changedCastles.right = next.castles.right;
    }
    delta.castles = changedCastles;
  }

  if (!isDeepEqual(previous.battleLane, next.battleLane)) {
    delta.battleLane = next.battleLane;
  }

  if (!isDeepEqual(previous.events, next.events)) {
    delta.events = next.events;
  }
  if (previous.nextUnitId !== next.nextUnitId) {
    delta.nextUnitId = next.nextUnitId;
  }
  if (!isDeepEqual(previous.nukeEffect, next.nukeEffect)) {
    delta.nukeEffect = next.nukeEffect;
  }
  if (!isDeepEqual(previous.nukeUsed, next.nukeUsed)) {
    delta.nukeUsed = next.nukeUsed;
  }

  const previousUnits = previous.units ?? {};
  const nextUnits = next.units ?? {};
  const changedUnits = {};
  const removedUnits = [];
  let hasUnitChanges = false;

  for (const [id, unit] of Object.entries(nextUnits)) {
    if (!isDeepEqual(previousUnits[id], unit)) {
      changedUnits[id] = unit;
      hasUnitChanges = true;
    }
  }

  for (const id of Object.keys(previousUnits)) {
    if (nextUnits[id] === undefined) {
      removedUnits.push(id);
      hasUnitChanges = true;
    }
  }

  if (hasUnitChanges) {
    delta.units = {
      changed: changedUnits,
      removed: removedUnits,
    };
  }

  return delta;
}

function createMatchStatePayload(match, { forceFull = false } = {}) {
  if (!match) return { snapshot: null, state: null, stateDelta: null };
  const extracted = extractState(match);
  const useFullState = forceFull
    || !match.__lastTransportState
    || (match.serverTick % FULL_STATE_EVERY_TICKS) === 0;
  const snapshot = createMatchSnapshot(match);

  if (useFullState) {
    match.__lastTransportState = cloneForTransport(extracted);
    return {
      type: NETWORK_MESSAGE_TYPE.STATE,
      snapshot,
      state: extracted,
    };
  }

  const delta = diffMatchState(match.__lastTransportState, extracted);
  match.__lastTransportState = cloneForTransport(extracted);
  return {
    type: NETWORK_MESSAGE_TYPE.STATE,
    snapshot,
    stateDelta: delta,
  };
}

function touchMatch(match) {
  if (!match) return;
  match.__lastActivityMs = Date.now();
}

function isMatchIdleForCleanup(match, nowMs) {
  const hasConnectedSocket = Boolean(match.clients?.left) || Boolean(match.clients?.right);
  if (hasConnectedSocket) return false;

  const leftConnected = Boolean(match.players?.left?.connected);
  const rightConnected = Boolean(match.players?.right?.connected);
  if (leftConnected || rightConnected) return false;

  return (nowMs - (match.__lastActivityMs ?? 0)) >= MATCH_DISCONNECT_TIMEOUT_MS;
}

const wss = new WebSocketServer({ port: PORT });
const matches = new Map();
const clientSessions = new Map();

function getOrCreateMatch(matchId) {
  let match = matches.get(matchId);
  if (match) return match;

  match = createMatch({
    matchId,
    data: GAME_DATA,
    tickRateMs: TICK_INTERVAL_MS,
  });
  match.clients = {
    left: null,
    right: null,
  };
  match.__lastActivityMs = Date.now();
  match.__lastTransportState = null;
  matches.set(matchId, match);
  return match;
}

function sendJson(ws, payload) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

function broadcastMatch(match, payload) {
  for (const side of ['left', 'right']) {
    const ws = match.clients[side];
    if (!ws) continue;
    sendJson(ws, payload);
  }
}

function attachClientToSide(match, side, ws) {
  const previousWs = match.clients[side];
  if (previousWs && previousWs !== ws && previousWs.readyState === previousWs.OPEN) {
    sendJson(previousWs, {
      type: NETWORK_MESSAGE_TYPE.ERROR,
      message: NETWORK_MESSAGE_TEXT.REPLACED_BY_NEWER_CONNECTION,
    });
    previousWs.close();
  }
  match.clients[side] = ws;
}

function clearClient(match, ws) {
  if (match.clients.left === ws) match.clients.left = null;
  if (match.clients.right === ws) match.clients.right = null;
}

function handleJoin(ws, msg) {
  const playerId = msg.playerId;
  const matchId = msg.matchId ?? 'room-1';
  const sessionToken = msg.sessionToken;
  if (MATCH_AUTH_TOKEN && msg?.authToken !== MATCH_AUTH_TOKEN) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.INVALID_AUTH_TOKEN });
    return;
  }
  if (!playerId) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.PLAYER_ID_REQUIRED });
    return;
  }

  const match = getOrCreateMatch(matchId);
  const existingPlayerSlot = match.players.left?.playerId === playerId
    ? match.players.left
    : match.players.right?.playerId === playerId
      ? match.players.right
      : null;

  if (existingPlayerSlot) {
    if (!sessionToken) {
      sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.SESSION_TOKEN_REQUIRED });
      return;
    }
    if (existingPlayerSlot.sessionToken !== sessionToken) {
      sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.SESSION_TOKEN_MISMATCH });
      return;
    }
  }

  const side = joinMatch(match, playerId);
  if (!side) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR });
    return;
  }

  attachClientToSide(match, side, ws);
  clientSessions.set(ws, { matchId, playerId, side });
  touchMatch(match);

  sendJson(ws, {
    type: NETWORK_MESSAGE_TYPE.JOINED,
    matchId,
    side,
    playerId,
    sessionToken: match.players[side]?.sessionToken,
    tickRateMs: match.tickRateMs,
    nextCommandSeq: (match.players[side]?.lastAcceptedSeq ?? -1) + 1,
  });

  broadcastMatch(match, {
    ...createMatchStatePayload(match, { forceFull: true }),
  });
}

function handleReady(ws, msg) {
  const session = clientSessions.get(ws);
  if (!session) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.JOIN_FIRST });
    return;
  }

  const match = matches.get(session.matchId);
  if (!match) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.JOIN_FIRST });
    return;
  }
  if (typeof msg?.ready !== 'boolean') {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.READY_REQUIRED });
    return;
  }

  setPlayerReady(match, session.playerId, Boolean(msg.ready));
  touchMatch(match);
  broadcastMatch(match, {
    ...createMatchStatePayload(match, { forceFull: true }),
  });
}

function handleCommand(ws, msg) {
  const session = clientSessions.get(ws);
  if (!session) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.JOIN_FIRST });
    return;
  }

  const match = matches.get(session.matchId);
  if (!match) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.JOIN_FIRST });
    return;
  }
  if (!msg.command) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.COMMAND_REQUIRED });
    return;
  }
  if (!Number.isInteger(msg.seq)) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.SEQ_REQUIRED });
    return;
  }

  const accepted = enqueuePlayerCommand(match, session.playerId, msg.command, msg.seq);
  if (!accepted) {
    const reason = match.__lastCommandRejectReason ?? NETWORK_MESSAGE_TEXT.COMMAND_REJECTED;
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: reason, seq: msg.seq });
    return;
  }
  touchMatch(match);
  sendJson(ws, { type: NETWORK_MESSAGE_TYPE.COMMAND_ACK, seq: msg.seq });
}

function handleSnapshotRequest(ws) {
  const session = clientSessions.get(ws);
  if (!session) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.JOIN_FIRST });
    return;
  }
  const match = matches.get(session.matchId);
  if (!match) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.JOIN_FIRST });
    return;
  }
  touchMatch(match);
  sendJson(ws, {
    ...createMatchStatePayload(match, { forceFull: true }),
  });
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.INVALID_JSON });
    return;
  }

  if (!msg?.type) {
    sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.TYPE_REQUIRED });
    return;
  }

  if (msg.type === NETWORK_MESSAGE_TYPE.JOIN) {
    handleJoin(ws, msg);
    return;
  }
  if (msg.type === NETWORK_MESSAGE_TYPE.READY) {
    handleReady(ws, msg);
    return;
  }
  if (msg.type === NETWORK_MESSAGE_TYPE.COMMAND) {
    handleCommand(ws, msg);
    return;
  }
  if (msg.type === NETWORK_MESSAGE_TYPE.SNAPSHOT_REQUEST) {
    handleSnapshotRequest(ws);
    return;
  }

  sendJson(ws, { type: NETWORK_MESSAGE_TYPE.ERROR, message: formatUnknownMessage(msg.type) });
}

function handleDisconnect(ws) {
  const session = clientSessions.get(ws);
  if (!session) return;
  clientSessions.delete(ws);

  const match = matches.get(session.matchId);
  if (!match) return;

  const isCurrentConnection = match.clients[session.side] === ws;
  clearClient(match, ws);
  if (!isCurrentConnection) {
    // If this socket is stale and has been replaced, don't force disconnect.
    return;
  }

  disconnectPlayer(match, session.playerId);
  touchMatch(match);
  broadcastMatch(match, {
    ...createMatchStatePayload(match, { forceFull: true }),
  });
}

function cleanupMatches() {
  const nowMs = Date.now();
  for (const [matchId, match] of matches.entries()) {
    if (!isMatchIdleForCleanup(match, nowMs)) continue;
    matches.delete(matchId);
    for (const [sessionWs, session] of clientSessions.entries()) {
      if (session.matchId === matchId) {
        clientSessions.delete(sessionWs);
      }
    }
  }
}

wss.on('connection', (ws) => {
  sendJson(ws, {
    type: NETWORK_MESSAGE_TYPE.HELLO,
    message: NETWORK_MESSAGE_TEXT.HELLO_MESSAGE,
  });
  ws.on('message', (raw) => handleMessage(ws, raw));
  ws.on('close', () => handleDisconnect(ws));
});

setInterval(() => {
  for (const match of matches.values()) {
    const beforeTick = match.serverTick;
    advanceMatchTick(match);
    if (match.serverTick === beforeTick) continue;
    broadcastMatch(match, createMatchStatePayload(match));
  }
}, TICK_INTERVAL_MS);

setInterval(cleanupMatches, MATCH_CLEANUP_INTERVAL_MS);

console.log(`Match server listening on ws://localhost:${PORT}`);

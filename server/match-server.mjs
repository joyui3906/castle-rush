import { WebSocketServer } from 'ws';
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

const PORT = Number(process.env.MATCH_PORT ?? 8787);
const TICK_INTERVAL_MS = Number(process.env.MATCH_TICK_MS ?? GAME_DATA.config.tickMs);

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
  matches.set(matchId, match);
  return match;
}

function getPublicMatchPayload(match) {
  return {
    snapshot: createMatchSnapshot(match),
    state: {
      tick: match.state.tick,
      timeMs: match.state.timeMs,
      winner: match.state.winner,
      castles: match.state.castles,
      battleLane: match.state.battleLane,
      events: match.state.events,
      units: match.state.units,
      nextUnitId: match.state.nextUnitId,
    },
  };
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
  match.clients[side] = ws;
}

function clearClient(match, ws) {
  if (match.clients.left === ws) match.clients.left = null;
  if (match.clients.right === ws) match.clients.right = null;
}

function handleJoin(ws, msg) {
  const playerId = msg.playerId;
  const matchId = msg.matchId ?? 'room-1';
  if (!playerId) {
    sendJson(ws, { type: 'error', message: 'playerId is required' });
    return;
  }

  const match = getOrCreateMatch(matchId);
  const side = joinMatch(match, playerId);
  if (!side) {
    sendJson(ws, { type: 'error', message: 'match is full' });
    return;
  }

  attachClientToSide(match, side, ws);
  clientSessions.set(ws, { matchId, playerId, side });

  sendJson(ws, {
    type: 'joined',
    matchId,
    side,
    playerId,
    tickRateMs: match.tickRateMs,
    nextCommandSeq: (match.players[side]?.lastAcceptedSeq ?? -1) + 1,
  });

  broadcastMatch(match, {
    type: 'state',
    ...getPublicMatchPayload(match),
  });
}

function handleReady(ws, msg) {
  const session = clientSessions.get(ws);
  if (!session) {
    sendJson(ws, { type: 'error', message: 'join first' });
    return;
  }

  const match = matches.get(session.matchId);
  if (!match) return;

  setPlayerReady(match, session.playerId, Boolean(msg.ready));
  broadcastMatch(match, {
    type: 'state',
    ...getPublicMatchPayload(match),
  });
}

function handleCommand(ws, msg) {
  const session = clientSessions.get(ws);
  if (!session) {
    sendJson(ws, { type: 'error', message: 'join first' });
    return;
  }

  const match = matches.get(session.matchId);
  if (!match) return;
  if (!msg.command) {
    sendJson(ws, { type: 'error', message: 'command is required' });
    return;
  }
  if (!Number.isInteger(msg.seq)) {
    sendJson(ws, { type: 'error', message: 'seq (integer) is required' });
    return;
  }

  const accepted = enqueuePlayerCommand(match, session.playerId, msg.command, msg.seq);
  if (!accepted) {
    sendJson(ws, { type: 'error', message: 'command rejected', seq: msg.seq });
    return;
  }
  sendJson(ws, { type: 'command_ack', seq: msg.seq });
}

function handleSnapshotRequest(ws) {
  const session = clientSessions.get(ws);
  if (!session) return;
  const match = matches.get(session.matchId);
  if (!match) return;
  sendJson(ws, {
    type: 'state',
    ...getPublicMatchPayload(match),
  });
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    sendJson(ws, { type: 'error', message: 'invalid json' });
    return;
  }

  if (!msg?.type) {
    sendJson(ws, { type: 'error', message: 'type is required' });
    return;
  }

  if (msg.type === 'join') {
    handleJoin(ws, msg);
    return;
  }
  if (msg.type === 'ready') {
    handleReady(ws, msg);
    return;
  }
  if (msg.type === 'command') {
    handleCommand(ws, msg);
    return;
  }
  if (msg.type === 'snapshot_request') {
    handleSnapshotRequest(ws);
    return;
  }

  sendJson(ws, { type: 'error', message: `unknown type: ${msg.type}` });
}

function handleDisconnect(ws) {
  const session = clientSessions.get(ws);
  if (!session) return;
  clientSessions.delete(ws);

  const match = matches.get(session.matchId);
  if (!match) return;

  clearClient(match, ws);
  disconnectPlayer(match, session.playerId);
  broadcastMatch(match, {
    type: 'state',
    ...getPublicMatchPayload(match),
  });
}

wss.on('connection', (ws) => {
  sendJson(ws, { type: 'hello', message: 'match server ready' });
  ws.on('message', (raw) => handleMessage(ws, raw));
  ws.on('close', () => handleDisconnect(ws));
});

setInterval(() => {
  for (const match of matches.values()) {
    const beforeTick = match.serverTick;
    advanceMatchTick(match);
    if (match.serverTick === beforeTick) continue;
    broadcastMatch(match, {
      type: 'state',
      ...getPublicMatchPayload(match),
    });
  }
}, TICK_INTERVAL_MS);

console.log(`Match server listening on ws://localhost:${PORT}`);

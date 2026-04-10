import { createInitialState, enqueueCommand, tick } from './sim.js';
import { NETWORK_MESSAGE_TEXT } from '../net/network-messages.js';

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function createSessionToken() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function setCommandRejectReason(match, reason) {
  match.__lastCommandRejectReason = reason || null;
}

function createPlayerSlot(playerId) {
  return {
    playerId,
    sessionToken: createSessionToken(),
    ready: false,
    connected: true,
    pendingCommands: [],
    lastAcceptedSeq: -1,
  };
}

function getPlayerBySide(match, side) {
  return match.players[side] ?? null;
}

function getSideByPlayerId(match, playerId) {
  if (match.players.left?.playerId === playerId) return 'left';
  if (match.players.right?.playerId === playerId) return 'right';
  return null;
}

function getCommandRejectReason(match, playerId, command) {
  if (!command?.type) {
    return NETWORK_MESSAGE_TEXT.COMMAND_REQUIRED;
  }
  const side = getSideByPlayerId(match, playerId);
  if (!side) {
    return NETWORK_MESSAGE_TEXT.NOT_IN_MATCH;
  }

  // Side-bound commands must match the command side to prevent spoofing.
  if (command.type === 'build' || command.type === 'sell' || command.type === 'nuke') {
    const payload = command.payload;
    if (!payload || typeof payload.side !== 'string' || payload.side !== side) {
      return NETWORK_MESSAGE_TEXT.INVALID_COMMAND_SIDE;
    }

    if (command.type === 'sell') {
      if (typeof payload.slotIndex !== 'number' || !Number.isInteger(payload.slotIndex) || payload.slotIndex < 0) {
        return NETWORK_MESSAGE_TEXT.INVALID_COMMAND;
      }
      return null;
    }

    if (command.type === 'build') {
      if (typeof payload.slotIndex !== 'undefined' && payload.slotIndex !== null) {
        if (typeof payload.slotIndex !== 'number' || !Number.isInteger(payload.slotIndex) || payload.slotIndex < 0) {
          return NETWORK_MESSAGE_TEXT.INVALID_COMMAND;
        }
      }
      if (typeof payload.buildingTypeId !== 'string' || payload.buildingTypeId.length === 0) {
        return NETWORK_MESSAGE_TEXT.INVALID_COMMAND;
      }
      return null;
    }

    if (command.type === 'nuke') return null;
    return null;
  }

  return NETWORK_MESSAGE_TEXT.INVALID_COMMAND;
}

export function createMatch({
  matchId = 'match-local',
  data,
  tickRateMs = 500,
} = {}) {
  const copiedData = cloneData(data);
  return {
    matchId,
    data: copiedData,
    state: createInitialState(copiedData),
    tickRateMs,
    status: 'waiting', // waiting | running | finished
    players: {
      left: null,
      right: null,
    },
    serverTick: 0,
  };
}

export function joinMatch(match, playerId) {
  const existingSide = getSideByPlayerId(match, playerId);
  if (existingSide) {
    const existingPlayer = getPlayerBySide(match, existingSide);
    if (existingPlayer) existingPlayer.connected = true;
    return existingSide;
  }

  if (!match.players.left) {
    match.players.left = createPlayerSlot(playerId);
    return 'left';
  }

  if (!match.players.right) {
    match.players.right = createPlayerSlot(playerId);
    return 'right';
  }

  return null;
}

export function setPlayerReady(match, playerId, ready) {
  const side = getSideByPlayerId(match, playerId);
  if (!side) return false;
  match.players[side].ready = Boolean(ready);

  const leftReady = Boolean(match.players.left?.ready);
  const rightReady = Boolean(match.players.right?.ready);
  if (leftReady && rightReady && match.status === 'waiting') {
    match.status = 'running';
  }

  return true;
}

export function disconnectPlayer(match, playerId) {
  const side = getSideByPlayerId(match, playerId);
  if (!side) return false;
  const player = getPlayerBySide(match, side);
  if (!player) return false;
  player.connected = false;
  return true;
}

export function enqueuePlayerCommand(match, playerId, command, seq = null) {
  setCommandRejectReason(match, null);
  const side = getSideByPlayerId(match, playerId);
  if (!side) {
    setCommandRejectReason(match, NETWORK_MESSAGE_TEXT.NOT_IN_MATCH);
    return false;
  }
  if (match.status !== 'running') {
    setCommandRejectReason(match, NETWORK_MESSAGE_TEXT.MATCH_NOT_RUNNING);
    return false;
  }
  const commandRejectReason = getCommandRejectReason(match, playerId, command);
  if (commandRejectReason) {
    setCommandRejectReason(match, commandRejectReason);
    return false;
  }

  const player = match.players[side];
  if (!player) {
    setCommandRejectReason(match, NETWORK_MESSAGE_TEXT.PLAYER_MISSING);
    return false;
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq)) {
    setCommandRejectReason(match, NETWORK_MESSAGE_TEXT.INVALID_COMMAND_SEQ);
    return false;
  }
  if (seq < player.lastAcceptedSeq) {
    setCommandRejectReason(match, NETWORK_MESSAGE_TEXT.STALE_COMMAND_SEQ);
    return false;
  }
  if (seq === player.lastAcceptedSeq) {
    // Idempotent duplicate packet (likely ack loss): treat as accepted without requeue.
    setCommandRejectReason(match, null);
    return true;
  }
  player.lastAcceptedSeq = seq;

  player.pendingCommands.push(command);
  return true;
}

function flushPlayerCommands(match) {
  for (const side of ['left', 'right']) {
    const player = match.players[side];
    if (!player) continue;
    for (const command of player.pendingCommands) {
      enqueueCommand(match.state, command);
    }
    player.pendingCommands.length = 0;
  }
}

export function advanceMatchTick(match) {
  if (match.status !== 'running') return;

  flushPlayerCommands(match);
  tick(match.state, match.data);
  match.serverTick += 1;

  if (match.state.winner) {
    match.status = 'finished';
  }
}

export function createMatchSnapshot(match) {
  return {
    matchId: match.matchId,
    status: match.status,
    serverTick: match.serverTick,
    winner: match.state.winner,
    stateTick: match.state.tick,
    players: {
      left: match.players.left ? {
        playerId: match.players.left.playerId,
        ready: match.players.left.ready,
        connected: match.players.left.connected,
        lastAcceptedSeq: match.players.left.lastAcceptedSeq,
      } : null,
      right: match.players.right ? {
        playerId: match.players.right.playerId,
        ready: match.players.right.ready,
        connected: match.players.right.connected,
        lastAcceptedSeq: match.players.right.lastAcceptedSeq,
      } : null,
    },
  };
}

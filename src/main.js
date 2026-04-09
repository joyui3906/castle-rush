import { GAME_DATA } from './data/game-data.js';
import { createInitialState, processCommandQueue, tick } from './core/sim.js';
import { render } from './render/render.js';
import { setupControls } from './ui/controls.js';
import { createMatchClient } from './net/match-client.js';

const root = document.querySelector('#app');
const controlsRoot = document.querySelector('#controls');
const state = createInitialState(GAME_DATA);
const params = new URLSearchParams(window.location.search);
const networkMode = params.get('net') === '1';

const defaultWsUrl = params.get('wsUrl') ?? `ws://${window.location.hostname}:8787`;
state.ui.network.enabled = networkMode;
state.ui.network.serverUrl = defaultWsUrl;
state.ui.network.matchId = params.get('matchId') ?? 'room-1';
state.ui.network.playerId = params.get('playerId') ?? `p-${Math.floor(Math.random() * 100000)}`;

const simulation = {
  paused: networkMode,
  speed: 1,
};
let timerId = null;
let matchClient = null;
const pendingNetworkCommands = new Map();
const COMMAND_ACK_TIMEOUT_MS = 1200;
const COMMAND_MAX_RETRY = 3;

function applyRemoteState(remoteState) {
  if (!remoteState) return;
  state.tick = remoteState.tick;
  state.timeMs = remoteState.timeMs;
  state.winner = remoteState.winner;
  state.battleLane = remoteState.battleLane;
  state.castles = remoteState.castles;
  state.events = remoteState.events;
  state.units = remoteState.units;
  state.nextUnitId = remoteState.nextUnitId;
}

function updatePendingCommandCount() {
  state.ui.network.pendingCommandCount = pendingNetworkCommands.size;
}

function clearPendingNetworkCommands() {
  pendingNetworkCommands.clear();
  updatePendingCommandCount();
}

const rerender = () => {
  if (!networkMode) {
    processCommandQueue(state, GAME_DATA);
  }
  render(root, state, GAME_DATA);
};

const stepOnce = () => {
  tick(state, GAME_DATA);
  rerender();
  if (state.winner) restartLoop();
};

const restartLoop = () => {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }

  if (networkMode) return;
  if (simulation.paused || state.winner) return;

  const intervalMs = Math.max(50, Math.floor(GAME_DATA.config.tickMs / simulation.speed));
  timerId = setInterval(stepOnce, intervalMs);
};

const rerenderControls = () => renderControls();

function ensureClient() {
  if (!networkMode) return null;
  if (matchClient) return matchClient;

  matchClient = createMatchClient({
    serverUrl: state.ui.network.serverUrl,
    onOpen: () => {
      state.ui.network.connecting = false;
      state.ui.network.connected = true;
      state.ui.network.lastError = null;
      state.ui.network.matchStatus = 'connected';
      matchClient.join({
        matchId: state.ui.network.matchId,
        playerId: state.ui.network.playerId,
      });
      rerenderControls();
    },
    onClose: () => {
      state.ui.network.connected = false;
      state.ui.network.connecting = false;
      state.ui.network.ready = false;
      state.ui.network.side = null;
      state.ui.network.matchStatus = 'offline';
      clearPendingNetworkCommands();
      rerenderControls();
    },
    onError: () => {
      state.ui.network.connecting = false;
      state.ui.network.connected = false;
      state.ui.network.lastError = 'socket error';
      state.ui.network.matchStatus = 'error';
      rerenderControls();
    },
    onMessage: (message) => {
      if (message.type === 'joined') {
        state.ui.network.side = message.side;
        state.ui.network.matchStatus = 'joined';
        if (Number.isInteger(message.nextCommandSeq)) {
          state.ui.network.commandSeq = Math.max(0, message.nextCommandSeq - 1);
        }
        matchClient.requestSnapshot();
        rerenderControls();
        return;
      }

      if (message.type === 'state') {
        applyRemoteState(message.state);
        state.winner = message.snapshot?.winner ?? state.winner;
        state.ui.network.matchStatus = message.snapshot?.status ?? state.ui.network.matchStatus;
        state.ui.network.lastStateTick = message.snapshot?.stateTick ?? state.tick;
        state.ui.network.lastServerTick = message.snapshot?.serverTick ?? 0;
        state.ui.network.lastSnapshotAtMs = Date.now();
        rerender();
        rerenderControls();
        return;
      }

      if (message.type === 'command_ack') {
        const pending = pendingNetworkCommands.get(message.seq);
        if (pending) {
          state.ui.network.rttMs = Date.now() - pending.sentAtMs;
          pendingNetworkCommands.delete(message.seq);
          updatePendingCommandCount();
          rerenderControls();
        }
        return;
      }

      if (message.type === 'error') {
        if (Number.isInteger(message.seq)) {
          pendingNetworkCommands.delete(message.seq);
          updatePendingCommandCount();
        }
        state.ui.network.lastError = message.message ?? 'server error';
        rerenderControls();
      }
    },
  });

  return matchClient;
}

const renderControls = setupControls(controlsRoot, state, GAME_DATA, () => {
  rerender();
  rerenderControls();
}, {
  getPaused: () => simulation.paused,
  getSpeed: () => simulation.speed,
  setPaused: (paused) => {
    simulation.paused = paused;
    restartLoop();
  },
  setSpeed: (speed) => {
    simulation.speed = speed;
    restartLoop();
  },
  stepOnce: () => {
    if (state.winner || networkMode) return;
    stepOnce();
  },
  isNetworkMode: () => networkMode,
  getNetworkInfo: () => state.ui.network,
  updateNetworkConfig: (patch) => {
    const prevUrl = state.ui.network.serverUrl;
    state.ui.network = { ...state.ui.network, ...patch };
    if (patch.serverUrl && patch.serverUrl !== prevUrl) {
      if (matchClient) {
        matchClient.disconnect();
        matchClient = null;
      }
      clearPendingNetworkCommands();
      state.ui.network.connected = false;
      state.ui.network.connecting = false;
      state.ui.network.side = null;
      state.ui.network.ready = false;
      state.ui.network.matchStatus = 'offline';
    }
  },
  connectNetwork: async () => {
    if (!networkMode) return;
    state.ui.network.connecting = true;
    state.ui.network.lastError = null;
    const client = ensureClient();
    if (!client) return;
    try {
      await client.connect();
    } catch {
      state.ui.network.connecting = false;
      state.ui.network.lastError = 'connect failed';
    }
  },
  disconnectNetwork: () => {
    if (!matchClient) return;
    matchClient.disconnect();
    matchClient = null;
    clearPendingNetworkCommands();
  },
  toggleNetworkReady: () => {
    if (!matchClient || !state.ui.network.connected) return;
    const nextReady = !state.ui.network.ready;
    state.ui.network.ready = nextReady;
    matchClient.ready(nextReady);
  },
  requestNetworkSnapshot: () => {
    if (!matchClient || !state.ui.network.connected) return;
    matchClient.requestSnapshot();
  },
  dispatchNetworkCommand: (command) => {
    if (!networkMode) return false;
    if (!matchClient || !state.ui.network.connected) return false;
    state.ui.network.commandSeq += 1;
    const seq = state.ui.network.commandSeq;
    const sent = matchClient.command(command, seq);
    if (!sent) return false;
    pendingNetworkCommands.set(seq, {
      command,
      sentAtMs: Date.now(),
      retries: 0,
    });
    updatePendingCommandCount();
    return true;
  },
});

if (networkMode) {
  setInterval(() => {
    if (!matchClient || !state.ui.network.connected) return;
    const now = Date.now();
    for (const [seq, pending] of pendingNetworkCommands.entries()) {
      if (now - pending.sentAtMs < COMMAND_ACK_TIMEOUT_MS) continue;
      if (pending.retries >= COMMAND_MAX_RETRY) {
        pendingNetworkCommands.delete(seq);
        state.ui.network.lastError = `command seq ${seq} timed out`;
        updatePendingCommandCount();
        rerenderControls();
        continue;
      }
      const resent = matchClient.command(pending.command, seq);
      if (!resent) continue;
      pending.retries += 1;
      pending.sentAtMs = now;
    }
    updatePendingCommandCount();
  }, 250);
}

rerender();
rerenderControls();
restartLoop();

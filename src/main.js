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
      rerenderControls();
    },
    onError: () => {
      state.ui.network.connecting = false;
      state.ui.network.connected = false;
      state.ui.network.lastError = 'socket error';
      rerenderControls();
    },
    onMessage: (message) => {
      if (message.type === 'joined') {
        state.ui.network.side = message.side;
        rerenderControls();
        return;
      }

      if (message.type === 'state') {
        applyRemoteState(message.state);
        state.winner = message.snapshot?.winner ?? state.winner;
        rerender();
        return;
      }

      if (message.type === 'error') {
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
      state.ui.network.connected = false;
      state.ui.network.connecting = false;
      state.ui.network.side = null;
      state.ui.network.ready = false;
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
    return matchClient.command(command, state.ui.network.commandSeq);
  },
});

rerender();
rerenderControls();
restartLoop();

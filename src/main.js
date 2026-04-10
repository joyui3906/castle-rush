import { GAME_DATA } from './data/game-data.js';
import {
  canBuild,
  createInitialState,
  enqueueCommand,
  processCommandQueue,
  tick,
} from './core/sim.js';
import { render } from './render/render.js';
import { setupControls } from './ui/controls.js';
import { createMatchClient } from './net/match-client.js';
import {
  NETWORK_MESSAGE_TEXT,
  NETWORK_MESSAGE_TYPE,
  NETWORK_PHASE,
  REFRESHABLE_COMMAND_ERROR_REASONS,
  formatCommandSeqTimeout,
  formatCommandSeqTimeoutBanner,
  formatJoinFailure,
  formatReconnectCountdown,
  formatReconnectTimeoutBanner,
  formatServerError,
  formatSessionTokenHint,
  normalizeNetworkMessage,
} from './net/network-messages.js';

const root = document.querySelector('#app');
const controlsRoot = document.querySelector('#controls');
const state = createInitialState(GAME_DATA);
const params = new URLSearchParams(window.location.search);
const networkMode = params.get('net') === '1';
const singlePlayerModeEnabled = !networkMode && (params.has('single') || params.has('solo'));
const singlePlayerHumanSide = (params.get('humanSide') === 'right' ? 'right' : 'left');
function normalizeSinglePlayerAiProfile(profile) {
  const requested = (profile ?? 'balanced').toLowerCase();
  if (requested === 'econ' || requested === 'economy' || requested === 'economic') return 'econ';
  if (requested === 'aggressive' || requested === 'rush' || requested === 'aggro') return 'aggressive';
  return 'balanced';
}
const singlePlayerAiProfile = normalizeSinglePlayerAiProfile(params.get('aiProfile'));
const NETWORK_RECONNECT_MAX_ATTEMPTS = state.ui.network.reconnectMaxAttempts || 8;
const NETWORK_RECONNECT_BASE_DELAY_MS = 800;
const SINGLE_PLAYER_AI_PLAN = Object.freeze([
  { slotIndex: 0, buildingTypeId: 'income_mine' },
  { slotIndex: 1, buildingTypeId: 'barracks' },
]);
const SINGLE_PLAYER_AI_FALLBACK_TYPES = Object.freeze(['barracks', 'range_tower', 'tank_forge', 'splash_tower']);
const SINGLE_PLAYER_AI_PROFILE_ORDERS = Object.freeze({
  econ: ['income_mine', 'income_mine', 'income_mine', 'income_mine', 'barracks', 'range_tower', 'tank_forge', 'splash_tower'],
  balanced: ['income_mine', 'barracks', 'range_tower', 'tank_forge', 'splash_tower'],
  aggressive: ['barracks', 'barracks', 'barracks', 'tank_forge', 'splash_tower', 'splash_tower', 'splash_tower', 'range_tower'],
});
const SINGLE_PLAYER_AI_TARGETS = Object.freeze({
  econ: Object.freeze({
    income_mine: 4,
    barracks: 1,
    range_tower: 1,
    tank_forge: 1,
    splash_tower: 2,
  }),
  balanced: Object.freeze({
    income_mine: 1,
    barracks: 1,
    range_tower: 1,
    tank_forge: 1,
    splash_tower: 1,
  }),
  aggressive: Object.freeze({
    income_mine: 1,
    barracks: 4,
    range_tower: 1,
    tank_forge: 2,
    splash_tower: 3,
  }),
});

function applySinglePlayerModeState(targetState, options = {}) {
  const modeEnabled = options.enabled ?? singlePlayerModeEnabled;
  const modeHumanSide = options.humanSide ?? singlePlayerHumanSide;
  const modeAiProfile = options.aiProfile ?? singlePlayerAiProfile;
  if (!targetState?.ui?.singleMode) return;
  if (!modeEnabled) {
    targetState.ui.singleMode.enabled = false;
    return;
  }
  targetState.ui.singleMode.enabled = true;
  targetState.ui.singleMode.humanSide = modeHumanSide;
  targetState.ui.singleMode.aiSide = modeHumanSide === 'left' ? 'right' : 'left';
  targetState.ui.singleMode.aiProfile = modeAiProfile;
  targetState.ui.singleMode.aiBuildPlan = [...SINGLE_PLAYER_AI_PLAN];
}

function isSinglePlayerMode() {
  return !networkMode && state.ui?.singleMode?.enabled;
}

function getSinglePlayerAiBuildingCounts(side) {
  const castle = state.castles?.[side];
  const counts = {};
  for (const slot of castle?.slots ?? []) {
    if (!slot?.buildingTypeId || slot.buildingHp <= 0) continue;
    counts[slot.buildingTypeId] = (counts[slot.buildingTypeId] || 0) + 1;
  }
  return counts;
}

function getSinglePlayerAiEmptySlotIndex(castle) {
  if (!castle?.slots) return null;
  const index = castle.slots.findIndex((slot) => !slot.buildingTypeId);
  return index >= 0 ? index : null;
}

function tryEnqueueSinglePlayerBuild(side, buildingTypeId, slotIndex = null) {
  if (!buildingTypeId) return false;

  const castle = state.castles?.[side];
  const resolvedSlotIndex = Number.isInteger(slotIndex) && slotIndex >= 0
    ? slotIndex
    : getSinglePlayerAiEmptySlotIndex(castle);

  if (!Number.isInteger(resolvedSlotIndex) || resolvedSlotIndex < 0) return false;

  if (!canBuild(state, GAME_DATA, side, buildingTypeId, resolvedSlotIndex)) return false;

  enqueueCommand(state, {
    type: 'build',
    payload: {
      side,
      buildingTypeId,
      slotIndex: resolvedSlotIndex,
    },
  });
  return true;
}

function getSinglePlayerAiFallbackType(side) {
  const counts = getSinglePlayerAiBuildingCounts(side);
  const profile = state.ui?.singleMode?.aiProfile || singlePlayerAiProfile;
  const order = SINGLE_PLAYER_AI_PROFILE_ORDERS[profile] ?? SINGLE_PLAYER_AI_PROFILE_ORDERS.balanced;
  const targets = SINGLE_PLAYER_AI_TARGETS[profile] ?? SINGLE_PLAYER_AI_TARGETS.balanced;
  const targetSet = new Set(order);

  for (const type of order) {
    if (!targetSet.has(type)) continue;
    const current = counts[type] ?? 0;
    const target = targets[type] ?? 0;
    if (current < target) return type;
  }

  for (const type of SINGLE_PLAYER_AI_FALLBACK_TYPES) {
    if ((counts[type] ?? 0) < 2) return type;
  }

  return SINGLE_PLAYER_AI_FALLBACK_TYPES[0];
}

const defaultWsUrl = params.get('wsUrl') ?? `ws://${window.location.hostname}:8787`;
state.ui.network.enabled = networkMode;
state.ui.network.serverUrl = defaultWsUrl;
state.ui.network.matchId = params.get('matchId') ?? 'room-1';
state.ui.network.playerId = params.get('playerId') ?? `p-${Math.floor(Math.random() * 100000)}`;
state.ui.network.authToken = params.get('matchAuthToken') ?? '';
const initialSingleModeConfig = {
  enabled: singlePlayerModeEnabled,
  humanSide: singlePlayerHumanSide,
  aiProfile: singlePlayerAiProfile,
};
let singleModeConfig = { ...initialSingleModeConfig };
applySinglePlayerModeState(state);

let matchStarted = Boolean(networkMode || singlePlayerModeEnabled);
const simulation = {
  paused: networkMode || !matchStarted,
  speed: 1,
};
let timerId = null;
let matchClient = null;
let manualDisconnectRequested = false;
let joinFailureDisconnectReason = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const pendingNetworkCommands = new Map();
const COMMAND_ACK_TIMEOUT_MS = 1200;
const COMMAND_MAX_RETRY = 3;
state.ui.network.reconnectMaxAttempts = NETWORK_RECONNECT_MAX_ATTEMPTS;
const STATE_REFRESH_ON_COMMAND_ERROR = REFRESHABLE_COMMAND_ERROR_REASONS;

function isMatchPhaseFull() {
  return state.ui.network.matchPhase === NETWORK_PHASE.FULL;
}

function applyRemoteState(fullState) {
  if (!fullState) return;
  if (fullState.tick !== undefined) state.tick = fullState.tick;
  if (fullState.timeMs !== undefined) state.timeMs = fullState.timeMs;
  if (fullState.winner !== undefined) state.winner = fullState.winner;
  if (fullState.battleLane) state.battleLane = fullState.battleLane;
  if (fullState.castles) state.castles = fullState.castles;
  if (fullState.events) state.events = fullState.events;
  if (fullState.units) state.units = fullState.units;
  if (fullState.nextUnitId !== undefined) state.nextUnitId = fullState.nextUnitId;
  if (Object.prototype.hasOwnProperty.call(fullState, 'nukeUsed')) {
    state.ui.nukeUsed = fullState.nukeUsed ?? { left: false, right: false };
  }
  if (Object.prototype.hasOwnProperty.call(fullState, 'nukeEffect')) {
    state.ui.nukeEffect = fullState.nukeEffect ?? null;
  }
}

function applyRemoteStateDelta(stateDelta) {
  if (!stateDelta) return;
  if (stateDelta.tick !== undefined) state.tick = stateDelta.tick;
  if (stateDelta.timeMs !== undefined) state.timeMs = stateDelta.timeMs;
  if (stateDelta.winner !== undefined) state.winner = stateDelta.winner;

  if (stateDelta.castles) {
    if (stateDelta.castles.left) state.castles.left = stateDelta.castles.left;
    if (stateDelta.castles.right) state.castles.right = stateDelta.castles.right;
  }

  if (stateDelta.battleLane && state.battleLane) {
    state.battleLane = { ...state.battleLane, ...stateDelta.battleLane };
  } else if (stateDelta.battleLane) {
    state.battleLane = stateDelta.battleLane;
  }

  if (Array.isArray(stateDelta.events)) {
    state.events = stateDelta.events;
  }
  if (Object.prototype.hasOwnProperty.call(stateDelta, 'nukeUsed')) {
    state.ui.nukeUsed = stateDelta.nukeUsed ?? { left: false, right: false };
  }
  if (Object.prototype.hasOwnProperty.call(stateDelta, 'nukeEffect')) {
    state.ui.nukeEffect = stateDelta.nukeEffect ?? null;
  }

  if (stateDelta.units) {
    if (stateDelta.units.removed) {
      for (const unitId of stateDelta.units.removed) {
        delete state.units[unitId];
      }
    }
    if (stateDelta.units.changed) {
      Object.assign(state.units, stateDelta.units.changed);
    }
  }

  if (stateDelta.nextUnitId !== undefined) {
    state.nextUnitId = stateDelta.nextUnitId;
  }
}

function updatePendingCommandCount() {
  state.ui.network.pendingCommandCount = pendingNetworkCommands.size;
}

function clearPendingNetworkCommands() {
  pendingNetworkCommands.clear();
  updatePendingCommandCount();
}

const rerender = () => {
  if (!networkMode && matchStarted) {
    processCommandQueue(state, GAME_DATA);
  }
  render(root, state, GAME_DATA);
};

const getReconnectDelayMs = () => NETWORK_RECONNECT_BASE_DELAY_MS * (2 ** Math.min(reconnectAttempts, 5));

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function clearReconnectScheduleState() {
  state.ui.network.reconnectScheduledAtMs = null;
  state.ui.network.reconnectScheduledDelayMs = null;
}

function resetNetworkReconnectState() {
  clearReconnectTimer();
  reconnectAttempts = 0;
  state.ui.network.reconnectAttempts = reconnectAttempts;
  clearReconnectScheduleState();
}

function setMatchFullNetworkState() {
  resetNetworkReconnectState();
  state.ui.network.connected = false;
  state.ui.network.connecting = false;
  state.ui.network.ready = false;
  state.ui.network.sessionToken = null;
  state.ui.network.side = null;
  state.ui.network.matchStatus = NETWORK_PHASE.ERROR;
  state.ui.network.matchPhase = NETWORK_PHASE.FULL;
  state.ui.network.lastError = NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR;
  state.ui.network.reconnectBanner = NETWORK_MESSAGE_TEXT.FULL_MATCH_BANNER;
  state.ui.network.players = { left: null, right: null };
}

function setNetworkOfflineState(
  message,
  banner,
  matchStatus = NETWORK_PHASE.OFFLINE,
  matchPhase = NETWORK_PHASE.OFFLINE,
  options = {},
) {
  const {
    clearSessionToken = true,
    connectionHint = null,
  } = options;
  resetNetworkReconnectState();
  const nextBanner = banner === undefined ? message : banner;
  state.ui.network.connected = false;
  state.ui.network.connecting = false;
  state.ui.network.ready = false;
  if (clearSessionToken) {
    state.ui.network.sessionToken = null;
  }
  state.ui.network.side = null;
  state.ui.network.matchStatus = matchStatus;
  state.ui.network.matchPhase = matchPhase;
  state.ui.network.lastError = message;
  state.ui.network.connectionHint = connectionHint;
  state.ui.network.reconnectBanner = nextBanner;
  state.ui.network.players = { left: null, right: null };
}

function setNetworkConnectedState() {
  resetNetworkReconnectState();
  state.ui.network.connecting = false;
  state.ui.network.connected = true;
  state.ui.network.ready = false;
  state.ui.network.side = null;
  state.ui.network.matchStatus = NETWORK_PHASE.CONNECTED;
  state.ui.network.matchPhase = NETWORK_PHASE.CONNECTED;
  state.ui.network.connectionHint = null;
  state.ui.network.lastError = null;
  state.ui.network.reconnectBanner = null;
  state.ui.network.players = { left: null, right: null };
}

function setNetworkJoinedState(side) {
  state.ui.network.side = side;
  state.ui.network.ready = false;
  state.ui.network.connectionHint = null;
  state.ui.network.matchStatus = NETWORK_PHASE.JOINED;
  state.ui.network.matchPhase = NETWORK_PHASE.WAITING;
  state.ui.network.lastError = null;
  state.ui.network.reconnectBanner = null;
}

function beginNetworkConnectAttempt() {
  state.ui.network.connecting = true;
  state.ui.network.connected = false;
  state.ui.network.ready = false;
  state.ui.network.lastError = null;
  state.ui.network.reconnectBanner = null;
}

function markNetworkReconnectAttemptFailed(message, banner) {
  state.ui.network.connecting = false;
  state.ui.network.lastError = message;
  state.ui.network.reconnectBanner = banner;
}

function setNetworkTransientBanner(message, banner) {
  state.ui.network.connectionHint = null;
  state.ui.network.lastError = message;
  state.ui.network.reconnectBanner = banner;
}

function clearNetworkTransientMessages() {
  state.ui.network.connectionHint = null;
  state.ui.network.lastError = null;
  state.ui.network.reconnectBanner = null;
}

function canPerformNetworkAction() {
  return networkMode
    && !isMatchPhaseFull()
    && matchClient
    && state.ui.network.connected
    && Boolean(state.ui.network.side);
}

function canSendNetworkCommand() {
  return canPerformNetworkAction() && state.ui.network.matchPhase === NETWORK_PHASE.RUNNING;
}

function setReconnectCountdown(attempt, delayMs) {
  state.ui.network.reconnectAttempts = attempt;
  state.ui.network.reconnectScheduledAtMs = Date.now();
  state.ui.network.reconnectScheduledDelayMs = delayMs;
  state.ui.network.reconnectBanner = formatReconnectCountdown(attempt, delayMs, NETWORK_RECONNECT_MAX_ATTEMPTS);
}

function setNetworkReadyState(nextReady) {
  if (!canPerformNetworkAction()) return false;
  state.ui.network.ready = nextReady;
  state.ui.network.reconnectBanner = null;
  matchClient.ready(nextReady);
  return true;
}

function refreshReconnectCountdownBanner() {
  const { reconnectScheduledAtMs, reconnectScheduledDelayMs } = state.ui.network;
  if (!reconnectScheduledAtMs || !reconnectScheduledDelayMs) return false;
  if (state.ui.network.connected || state.ui.network.connecting || isMatchPhaseFull()) return false;
  if (state.ui.network.matchPhase === NETWORK_PHASE.OFFLINE && manualDisconnectRequested) return false;

  const remainingMs = reconnectScheduledDelayMs - (Date.now() - reconnectScheduledAtMs);
  if (remainingMs <= 0) {
    clearReconnectScheduleState();
    return false;
  }

  const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
  state.ui.network.reconnectBanner = formatReconnectCountdown(
    state.ui.network.reconnectAttempts,
    remainingSec * 1000,
    NETWORK_RECONNECT_MAX_ATTEMPTS,
  );
  return true;
}

function scheduleAutoReconnect() {
  if (!networkMode) return;
  if (manualDisconnectRequested) return;
  if (isMatchPhaseFull()) return;
  if (!state.ui.network.serverUrl || !state.ui.network.matchId || !state.ui.network.playerId) return;
  if (reconnectAttempts >= NETWORK_RECONNECT_MAX_ATTEMPTS) {
    clearReconnectScheduleState();
    setNetworkTransientBanner(
      NETWORK_MESSAGE_TEXT.RECONNECT_FAILED,
      formatReconnectTimeoutBanner(NETWORK_RECONNECT_MAX_ATTEMPTS),
    );
    rerenderControls();
    return;
  }
  if (reconnectTimer) return;

  const delayMs = getReconnectDelayMs();
  reconnectAttempts += 1;
  setReconnectCountdown(reconnectAttempts, delayMs);
  clearPendingNetworkCommands();
  rerenderControls();
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!networkMode || manualDisconnectRequested || isMatchPhaseFull()) return;
    beginNetworkConnectAttempt();
    rerenderControls();
    const client = ensureClient();
    if (!client) return;
    try {
      await client.connect();
    } catch {
      markNetworkReconnectAttemptFailed(
        NETWORK_MESSAGE_TEXT.RECONNECT_FAILED,
        NETWORK_MESSAGE_TEXT.RECONNECT_ATTEMPT_FAILED_BANNER,
      );
      clearReconnectScheduleState();
      rerenderControls();
      scheduleAutoReconnect();
    }
  }, delayMs);
}

function runSinglePlayerAIActions() {
  if (!isSinglePlayerMode()) return;
  const aiSide = state.ui.singleMode.aiSide;
  const plan = state.ui.singleMode.aiBuildPlan ?? [];
  if (!Array.isArray(plan)) return;

  for (let safety = 0; safety < 6; safety += 1) {
    const planItem = plan[0];
    if (!planItem || !planItem.buildingTypeId) {
      plan.shift();
      continue;
    }

    const slotIndex = Number(planItem.slotIndex);
    const slotSpecified = Number.isInteger(slotIndex) && slotIndex >= 0;
    const castle = state.castles?.[aiSide];
    if (!castle) return;
    const targetedSlot = slotSpecified ? castle.slots?.[slotIndex] : null;

    if (slotSpecified && !targetedSlot) {
      plan.shift();
      continue;
    }

    if (slotSpecified && targetedSlot?.buildingTypeId) {
      plan.shift();
      continue;
    }

    const built = slotSpecified
      ? tryEnqueueSinglePlayerBuild(aiSide, planItem.buildingTypeId, slotIndex)
      : tryEnqueueSinglePlayerBuild(aiSide, planItem.buildingTypeId, getSinglePlayerAiEmptySlotIndex(castle));
    if (built) {
      plan.shift();
      return;
    }

    if (!slotSpecified && !castle?.slots?.some((slot) => !slot.buildingTypeId)) {
      plan.shift();
      continue;
    }

    return;
  }

  const fallbackType = getSinglePlayerAiFallbackType(aiSide);
  tryEnqueueSinglePlayerBuild(aiSide, fallbackType);
}

const stepOnce = () => {
  if (!matchStarted) return;
  if (isSinglePlayerMode()) {
    runSinglePlayerAIActions();
  }
  tick(state, GAME_DATA);
  rerender();
  rerenderControls();
  if (state.winner) restartLoop();
};

function resetLocalStateWithFreshMatch(config) {
  const nextState = createInitialState(GAME_DATA);
  applySinglePlayerModeState(nextState, config);
  clearInterval(timerId);
  timerId = null;
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, nextState);
  clearPendingNetworkCommands();
}

function startLocalMatch(options = {}) {
  if (networkMode) return;
  singleModeConfig = {
    enabled: Boolean(options.enabled),
    humanSide: options.humanSide === 'right' ? 'right' : 'left',
    aiProfile: normalizeSinglePlayerAiProfile(options.aiProfile),
  };
  matchStarted = true;
  simulation.paused = false;
  resetLocalStateWithFreshMatch(singleModeConfig);
  restartLoop();
  rerender();
}

const restartLocalMatch = () => {
  if (networkMode) return;
  resetLocalStateWithFreshMatch(singleModeConfig);
  matchStarted = true;
  simulation.paused = false;
  restartLoop();
  rerender();
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

  const applyAutoReady = () => {
    if (!matchClient || !state.ui.network.autoReady) return;
    setNetworkReadyState(true);
  };
  const isRecoverableJoinError = (message) => {
    return message === NETWORK_MESSAGE_TEXT.INVALID_AUTH_TOKEN
      || message === NETWORK_MESSAGE_TEXT.PLAYER_ID_REQUIRED
      || message === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_REQUIRED
      || message === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_MISMATCH
      || message === NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR;
  };
  const isJoinErrorThatShouldKeepSession = (message) => (
    message === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_REQUIRED
    || message === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_MISMATCH
    || message === NETWORK_MESSAGE_TEXT.REPLACED_BY_NEWER_CONNECTION
  );

  const handleJoinFailure = (errorMessage) => {
    const hadActiveConnection = Boolean(matchClient && state.ui.network.connected);
    const normalizedMessage = normalizeNetworkMessage(errorMessage);
    if (normalizedMessage === NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR) {
      setMatchFullNetworkState();
    } else {
      const isSessionError = isJoinErrorThatShouldKeepSession(normalizedMessage);
      setNetworkOfflineState(
        formatServerError(normalizedMessage),
        formatServerError(normalizedMessage),
        NETWORK_PHASE.ERROR,
        NETWORK_PHASE.ERROR,
        {
          clearSessionToken: !isSessionError,
          connectionHint: formatSessionTokenHint(normalizedMessage),
        },
      );
    }
    clearPendingNetworkCommands();

    joinFailureDisconnectReason = normalizedMessage;
    if (hadActiveConnection && matchClient) {
      matchClient.disconnect();
      matchClient = null;
      return;
    }

    rerenderControls();
  };

  matchClient = createMatchClient({
    getSessionToken: () => state.ui.network.sessionToken,
    serverUrl: state.ui.network.serverUrl,
    onOpen: () => {
      setNetworkConnectedState();
      matchClient.join({
        matchId: state.ui.network.matchId,
        playerId: state.ui.network.playerId,
        authToken: state.ui.network.authToken,
        sessionToken: state.ui.network.sessionToken,
      });
      rerenderControls();
    },
    onClose: () => {
      if (manualDisconnectRequested) {
        manualDisconnectRequested = false;
        setNetworkOfflineState(
          NETWORK_MESSAGE_TEXT.MANUAL_DISCONNECT,
          NETWORK_MESSAGE_TEXT.MANUAL_DISCONNECT,
          NETWORK_PHASE.OFFLINE,
          NETWORK_PHASE.OFFLINE,
        );
      } else if (joinFailureDisconnectReason) {
        const isMatchFull = joinFailureDisconnectReason === NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR;
        if (isMatchFull) {
          setMatchFullNetworkState();
        } else {
          const keepSession = isJoinErrorThatShouldKeepSession(joinFailureDisconnectReason);
          setNetworkOfflineState(
            formatJoinFailure(joinFailureDisconnectReason),
            formatJoinFailure(joinFailureDisconnectReason),
            NETWORK_PHASE.ERROR,
            NETWORK_PHASE.ERROR,
            {
              clearSessionToken: !keepSession,
              connectionHint: formatSessionTokenHint(joinFailureDisconnectReason),
            },
          );
        }
        joinFailureDisconnectReason = null;
      } else {
        setNetworkOfflineState(
          NETWORK_MESSAGE_TEXT.SOCKET_CLOSED,
          NETWORK_MESSAGE_TEXT.SOCKET_CLOSED_BANNER,
          NETWORK_PHASE.OFFLINE,
          NETWORK_PHASE.OFFLINE,
          { clearSessionToken: false },
        );
        scheduleAutoReconnect();
      }
      clearPendingNetworkCommands();
      rerenderControls();
    },
    onError: () => {
      if (isMatchPhaseFull()) {
        setMatchFullNetworkState();
      } else {
        setNetworkOfflineState(
          NETWORK_MESSAGE_TEXT.SOCKET_ERROR,
          NETWORK_MESSAGE_TEXT.CONNECTION_ERROR_BANNER,
          NETWORK_PHASE.ERROR,
          NETWORK_PHASE.ERROR,
          { clearSessionToken: false },
        );
      }
      if (!manualDisconnectRequested && !joinFailureDisconnectReason) {
        scheduleAutoReconnect();
      }
      rerenderControls();
    },
    onMessage: (message) => {
      if (message.type === NETWORK_MESSAGE_TYPE.JOINED) {
        clearNetworkTransientMessages();
        setNetworkJoinedState(message.side);
        state.ui.network.sessionToken = message.sessionToken || null;
        if (Number.isInteger(message.nextCommandSeq)) {
          state.ui.network.commandSeq = Math.max(0, message.nextCommandSeq - 1);
        }
        applyAutoReady();
        matchClient.requestSnapshot();
        rerenderControls();
        return;
      }

      if (message.type === NETWORK_MESSAGE_TYPE.STATE) {
        if (message.state) {
          applyRemoteState(message.state);
        } else if (message.stateDelta) {
          applyRemoteStateDelta(message.stateDelta);
        }
        clearNetworkTransientMessages();
        state.winner = message.snapshot?.winner ?? state.winner;
        state.ui.network.matchPhase = message.snapshot?.status ?? state.ui.network.matchStatus;
        state.ui.network.lastStateTick = message.snapshot?.stateTick ?? state.tick;
        state.ui.network.lastServerTick = message.snapshot?.serverTick ?? 0;
        if (message.snapshot?.players) {
          state.ui.network.players = message.snapshot.players;
        }
        state.ui.network.lastSnapshotAtMs = Date.now();
        rerender();
        rerenderControls();
        return;
      }

      if (message.type === NETWORK_MESSAGE_TYPE.COMMAND_ACK) {
        const pending = pendingNetworkCommands.get(message.seq);
        if (pending) {
          state.ui.network.rttMs = Date.now() - pending.sentAtMs;
          pendingNetworkCommands.delete(message.seq);
          updatePendingCommandCount();
          rerenderControls();
        }
        return;
      }

      if (message.type === NETWORK_MESSAGE_TYPE.ERROR) {
        const messageText = normalizeNetworkMessage(message.message);
        if (messageText === NETWORK_MESSAGE_TEXT.REPLACED_BY_NEWER_CONNECTION
          || (!state.ui.network.side && isRecoverableJoinError(messageText))) {
          handleJoinFailure(messageText);
          return;
        }
        const shouldRefreshState = STATE_REFRESH_ON_COMMAND_ERROR.has(messageText);
        const hasSeq = Number.isInteger(message.seq);
        if (hasSeq) {
          pendingNetworkCommands.delete(message.seq);
          updatePendingCommandCount();
        }
        if (shouldRefreshState && matchClient && state.ui.network.connected && hasSeq) {
          matchClient.requestSnapshot();
        }
        if (messageText === NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR) {
          setMatchFullNetworkState();
          rerenderControls();
          return;
        }
        setNetworkTransientBanner(
          messageText,
          shouldRefreshState
            ? formatServerError(messageText, { refreshing: true })
            : formatServerError(messageText)
        );
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
  isMatchStarted: () => matchStarted,
  getSingleModeConfig: () => ({ ...singleModeConfig }),
  startMatch: (options) => {
    startLocalMatch(options);
  },
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
    const prevMatchId = state.ui.network.matchId;
    const prevPlayerId = state.ui.network.playerId;
    const prevAuthToken = state.ui.network.authToken;
    state.ui.network = { ...state.ui.network, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'sessionToken')) {
      state.ui.network.connectionHint = null;
    }
    const shouldResetConnection = (
      (Object.prototype.hasOwnProperty.call(patch, 'serverUrl') && patch.serverUrl !== prevUrl)
      || (Object.prototype.hasOwnProperty.call(patch, 'matchId') && patch.matchId !== prevMatchId)
      || (Object.prototype.hasOwnProperty.call(patch, 'playerId') && patch.playerId !== prevPlayerId)
      || (Object.prototype.hasOwnProperty.call(patch, 'authToken') && patch.authToken !== prevAuthToken)
    );

    if (shouldResetConnection) {
      resetNetworkReconnectState();
      if (matchClient) {
        matchClient.disconnect();
        matchClient = null;
      }
      clearPendingNetworkCommands();
      setNetworkOfflineState(
        NETWORK_MESSAGE_TEXT.OFFLINE_CONFIG_CHANGED,
        NETWORK_MESSAGE_TEXT.CONFIG_RESET_BANNER,
        NETWORK_PHASE.OFFLINE,
        NETWORK_PHASE.OFFLINE,
      );
    }
  },
  connectNetwork: async () => {
    if (!networkMode) return;
    const isMatchFull = isMatchPhaseFull();
    if (isMatchFull) {
      setNetworkOfflineState(
        NETWORK_MESSAGE_TEXT.FULL_MATCH_RETRY_TEXT,
        NETWORK_MESSAGE_TEXT.FULL_MATCH_RETRY_BANNER,
        NETWORK_PHASE.OFFLINE,
        NETWORK_PHASE.OFFLINE,
      );
    }
    resetNetworkReconnectState();
    beginNetworkConnectAttempt();
    clearPendingNetworkCommands();
    joinFailureDisconnectReason = null;
    const client = ensureClient();
    if (!client) return;
    try {
      await client.connect();
    } catch {
      setNetworkOfflineState(
        NETWORK_MESSAGE_TEXT.CONNECT_FAILED,
        NETWORK_MESSAGE_TEXT.CONNECT_FAILED_BANNER,
        NETWORK_PHASE.ERROR,
        NETWORK_PHASE.OFFLINE,
        { clearSessionToken: false },
      );
      scheduleAutoReconnect();
    }
  },
  disconnectNetwork: () => {
    if (!matchClient) return;
    manualDisconnectRequested = true;
    joinFailureDisconnectReason = null;
    resetNetworkReconnectState();
    matchClient.disconnect();
    matchClient = null;
    clearPendingNetworkCommands();
    setNetworkOfflineState(
      NETWORK_MESSAGE_TEXT.MANUAL_DISCONNECT,
      null,
      NETWORK_PHASE.OFFLINE,
      NETWORK_PHASE.OFFLINE,
      { clearSessionToken: true },
    );
  },
  toggleNetworkReady: () => {
    if (!canPerformNetworkAction()) return;
    const nextReady = !state.ui.network.ready;
    setNetworkReadyState(nextReady);
  },
  requestNetworkSnapshot: () => {
    if (!canPerformNetworkAction()) return;
    matchClient.requestSnapshot();
  },
  dispatchNetworkCommand: (command) => {
    if (!canSendNetworkCommand()) return false;
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
  restartMatch: () => {
    restartLocalMatch();
    rerenderControls();
  },
});

if (networkMode) {
  setInterval(() => {
    if (refreshReconnectCountdownBanner()) {
      rerenderControls();
    }
    if (!canPerformNetworkAction()) return;
    const now = Date.now();
    for (const [seq, pending] of pendingNetworkCommands.entries()) {
      if (now - pending.sentAtMs < COMMAND_ACK_TIMEOUT_MS) continue;
      if (pending.retries >= COMMAND_MAX_RETRY) {
        pendingNetworkCommands.delete(seq);
        setNetworkTransientBanner(
          formatCommandSeqTimeout(seq),
          formatCommandSeqTimeoutBanner(seq)
        );
        matchClient.requestSnapshot();
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

export const NETWORK_PHASE = {
  OFFLINE: 'offline',
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  WAITING: 'waiting',
  RUNNING: 'running',
  FINISHED: 'finished',
  FULL: 'full',
  ERROR: 'error',
  JOINED: 'joined',
};

export const NETWORK_MESSAGE_TEXT = {
  FULL_MATCH_ERROR: 'match is full',
  FULL_MATCH_BANNER: 'Cannot connect: match is full.',
  FULL_MATCH_RETRY_TEXT: 'Retrying connect after full match',
  FULL_MATCH_RETRY_BANNER: 'Retrying connect and checking slot availability.',
  MANUAL_DISCONNECT: 'Disconnected manually.',
  SOCKET_CLOSED: 'socket closed',
  SOCKET_CLOSED_BANNER: 'Disconnected. Use Connect to rejoin this match.',
  SOCKET_ERROR: 'socket error',
  CONNECTION_ERROR_BANNER: 'Connection error. Use Connect to retry.',
  CONNECT_FAILED: 'connect failed',
  CONNECT_FAILED_BANNER: 'Connect failed. Reconnecting automatically.',
  RECONNECT_FAILED: 'reconnect failed',
  RECONNECT_FAILED_BANNER: 'Reconnection failed after %s attempts.',
  RECONNECT_ATTEMPT_FAILED_BANNER: 'Reconnection attempt failed. Retrying...',
  OFFLINE_CONFIG_CHANGED: 'offline config changed',
  CONFIG_RESET_BANNER: 'Connection reset due to config update.',
  JOIN_FAILURE_PREFIX: 'Join failed:',
  INVALID_AUTH_TOKEN: 'invalid match auth token',
  PLAYER_ID_REQUIRED: 'playerId is required',
  SERVER_ERROR_PREFIX: 'Error from server:',
  INVALID_JSON: 'invalid json',
  UNKNOWN_MESSAGE_PREFIX: 'unknown type:',
  JOIN_FIRST: 'join first',
  SESSION_TOKEN_REQUIRED: 'session token required',
  SESSION_TOKEN_MISMATCH: 'session token mismatch',
  REPLACED_BY_NEWER_CONNECTION: 'replaced by newer connection',
  COMMAND_REQUIRED: 'command is required',
  INVALID_COMMAND: 'invalid command',
  SEQ_REQUIRED: 'seq (integer) is required',
  TYPE_REQUIRED: 'type is required',
  READY_REQUIRED: 'ready (boolean) is required',
  MATCH_NOT_RUNNING: 'match not running',
  INVALID_COMMAND_SIDE: 'invalid command side',
  INVALID_COMMAND_SEQ: 'invalid command seq',
  STALE_COMMAND_SEQ: 'stale command seq',
  NOT_IN_MATCH: 'not in match',
  PLAYER_MISSING: 'player missing',
  COMMAND_REJECTED: 'command rejected',
  COMMAND_TIMEOUT: 'command seq %s timed out',
  COMMAND_TIMEOUT_REFRESH_BANNER: 'command seq %s timed out; refreshing state',
  HELLO_MESSAGE: 'match server ready',
  SOCKET_CONNECTION_FAILED: 'WebSocket connection failed',
  INVALID_MESSAGE_PAYLOAD: 'invalid message payload',
};

export const NETWORK_MESSAGE_TYPE = {
  HELLO: 'hello',
  JOIN: 'join',
  READY: 'ready',
  COMMAND: 'command',
  SNAPSHOT_REQUEST: 'snapshot_request',
  JOINED: 'joined',
  STATE: 'state',
  COMMAND_ACK: 'command_ack',
  ERROR: 'error',
};

export const NETWORK_PLAYER_TEXT = {
  READY: 'ready',
  NOT_READY: 'not ready',
  ONLINE: 'online',
  OFFLINE: 'offline',
  UNKNOWN_PLAYER: 'unknown',
  YOU_TAG: '[you]',
};

export const REFRESHABLE_COMMAND_ERROR_REASONS = new Set([
  NETWORK_MESSAGE_TEXT.MATCH_NOT_RUNNING,
  NETWORK_MESSAGE_TEXT.INVALID_COMMAND_SIDE,
  NETWORK_MESSAGE_TEXT.INVALID_COMMAND_SEQ,
  NETWORK_MESSAGE_TEXT.STALE_COMMAND_SEQ,
  NETWORK_MESSAGE_TEXT.NOT_IN_MATCH,
  NETWORK_MESSAGE_TEXT.PLAYER_MISSING,
  NETWORK_MESSAGE_TEXT.COMMAND_REJECTED,
]);

export const NETWORK_COMMAND_TEXT = {
  FULL_RECONNECT_PREFIX: 'retry: manual',
  DISCONNECT_LABEL: 'Disconnect',
  CONNECT_LABEL: 'Connect',
  RETRY_LABEL: 'Retry',
  READY_LABEL: 'Ready',
  UNREADY_LABEL: 'Unready',
  SNAPSHOT_LABEL: 'Snapshot',
};

export const DEFAULT_SERVER_ERROR_TEXT = 'server error';

export function normalizeNetworkMessage(message) {
  return message || DEFAULT_SERVER_ERROR_TEXT;
}

export function formatServerError(message, { refreshing = false } = {}) {
  const normalizedMessage = normalizeNetworkMessage(message);
  if (normalizedMessage === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_REQUIRED) {
    const base = `${NETWORK_MESSAGE_TEXT.SERVER_ERROR_PREFIX} ${normalizedMessage}`;
    return `${base}. Paste the latest session token for this player and press Connect.`;
  }
  if (normalizedMessage === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_MISMATCH) {
    const base = `${NETWORK_MESSAGE_TEXT.SERVER_ERROR_PREFIX} ${normalizedMessage}`;
    return `${base}. Re-enter the exact token shown for this player in this match and press Connect.`;
  }
  const base = `${NETWORK_MESSAGE_TEXT.SERVER_ERROR_PREFIX} ${normalizedMessage}`;
  return refreshing ? `${base}. Refreshing state.` : base;
}

export function formatSessionTokenHint(message) {
  const normalizedMessage = normalizeNetworkMessage(message);
  if (normalizedMessage === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_REQUIRED) {
    return 'Session token required. Rejoin by pasting the token from your previous join and retrying.';
  }
  if (normalizedMessage === NETWORK_MESSAGE_TEXT.SESSION_TOKEN_MISMATCH) {
    return 'Session token mismatch. Paste the exact token for this Player ID/match pair, then retry.';
  }
  return '';
}

export function formatJoinFailure(message) {
  return `${NETWORK_MESSAGE_TEXT.JOIN_FAILURE_PREFIX} ${normalizeNetworkMessage(message)}`;
}

export function formatReconnectCountdown(attempt, delayMs, maxAttempts) {
  const delaySec = Math.round(delayMs / 1000);
  return `Reconnecting in ${delaySec}s (attempt ${attempt}/${maxAttempts})`;
}

export function formatReconnectTimeoutBanner(maxAttempts) {
  return NETWORK_MESSAGE_TEXT.RECONNECT_FAILED_BANNER.replace('%s', String(maxAttempts));
}

export function formatUnknownMessage(messageType) {
  return `${NETWORK_MESSAGE_TEXT.UNKNOWN_MESSAGE_PREFIX} ${messageType}`;
}

export function formatCommandSeqTimeout(seq) {
  return NETWORK_MESSAGE_TEXT.COMMAND_TIMEOUT.replace('%s', String(seq));
}

export function formatCommandSeqTimeoutBanner(seq) {
  return NETWORK_MESSAGE_TEXT.COMMAND_TIMEOUT_REFRESH_BANNER.replace('%s', String(seq));
}

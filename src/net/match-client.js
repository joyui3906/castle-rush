import { NETWORK_MESSAGE_TEXT, NETWORK_MESSAGE_TYPE } from './network-messages.js';

export function createMatchClient({
  serverUrl,
  getSessionToken,
  onOpen,
  onClose,
  onError,
  onMessage,
} = {}) {
  let ws = null;

  const connect = () => new Promise((resolve, reject) => {
    ws = new WebSocket(serverUrl);
    ws.onopen = () => {
      if (onOpen) onOpen();
      resolve();
    };
    ws.onclose = () => {
      if (onClose) onClose();
    };
    ws.onerror = (event) => {
      if (onError) onError(event);
      reject(new Error(NETWORK_MESSAGE_TEXT.SOCKET_CONNECTION_FAILED));
    };
    ws.onmessage = (event) => {
      if (!onMessage) return;
      try {
        const message = JSON.parse(event.data);
        onMessage(message);
      } catch {
        onMessage({ type: NETWORK_MESSAGE_TYPE.ERROR, message: NETWORK_MESSAGE_TEXT.INVALID_MESSAGE_PAYLOAD });
      }
    };
  });

  const send = (payload) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  };

  const disconnect = () => {
    if (!ws) return;
    ws.close();
    ws = null;
  };

  const attachSession = (payload) => {
    const sessionToken = getSessionToken ? getSessionToken() : null;
    if (!sessionToken) return payload;
    return { ...payload, sessionToken };
  };

  return {
    connect,
    disconnect,
    send,
    join: ({ matchId, playerId, authToken, sessionToken }) => send({
      type: NETWORK_MESSAGE_TYPE.JOIN,
      matchId,
      playerId,
      ...(sessionToken ? { sessionToken } : {}),
      ...(authToken ? { authToken } : {}),
    }),
    ready: (ready) => send(attachSession({ type: NETWORK_MESSAGE_TYPE.READY, ready })),
    command: (command, seq) => send(attachSession({ type: NETWORK_MESSAGE_TYPE.COMMAND, command, seq })),
    requestSnapshot: () => send(attachSession({ type: NETWORK_MESSAGE_TYPE.SNAPSHOT_REQUEST })),
  };
}

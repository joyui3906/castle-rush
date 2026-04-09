export function createMatchClient({
  serverUrl,
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
      reject(new Error('WebSocket connection failed'));
    };
    ws.onmessage = (event) => {
      if (!onMessage) return;
      try {
        const message = JSON.parse(event.data);
        onMessage(message);
      } catch {
        onMessage({ type: 'error', message: 'invalid message payload' });
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

  return {
    connect,
    disconnect,
    send,
    join: ({ matchId, playerId }) => send({ type: 'join', matchId, playerId }),
    ready: (ready) => send({ type: 'ready', ready }),
    command: (command, seq) => send({ type: 'command', command, seq }),
    requestSnapshot: () => send({ type: 'snapshot_request' }),
  };
}

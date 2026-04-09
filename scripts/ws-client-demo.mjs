import WebSocket from 'ws';

const SERVER_URL = process.env.MATCH_URL ?? 'ws://localhost:8787';
const MATCH_ID = process.env.MATCH_ID ?? 'room-1';

function createClient(playerId, sideBuildSlot) {
  const ws = new WebSocket(SERVER_URL);
  let seq = 0;

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'join',
      matchId: MATCH_ID,
      playerId,
    }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'hello') return;

    if (msg.type === 'joined') {
      console.log(`[${playerId}] joined as ${msg.side}`);
      ws.send(JSON.stringify({ type: 'ready', ready: true }));
      ws.send(JSON.stringify({
        type: 'command',
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

    if (msg.type === 'state') {
      const tick = msg.snapshot.stateTick;
      const winner = msg.snapshot.winner ?? 'none';
      if (tick % 20 === 0) {
        console.log(`[${playerId}] tick=${tick} winner=${winner}`);
      }
    }
  });

  ws.on('close', () => {
    console.log(`[${playerId}] disconnected`);
  });
}

createClient('alice', 0);
createClient('bob', 0);

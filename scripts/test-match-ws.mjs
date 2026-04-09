import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  NETWORK_MESSAGE_TEXT,
  formatUnknownMessage,
  NETWORK_MESSAGE_TYPE,
} from '../src/net/network-messages.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(scriptDir, '../server/match-server.mjs');
const MATCH_PORT = Number(process.env.TEST_MATCH_WS_PORT ?? 18887);
const MATCH_DISCONNECT_TIMEOUT_MS = 120;
const MATCH_CLEANUP_INTERVAL_MS = 40;
const MATCH_TICK_MS = 25;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runTest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL ${name}`);
      throw error;
    });
}

function connectServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        MATCH_PORT: String(MATCH_PORT),
        MATCH_DISCONNECT_TIMEOUT_MS: String(MATCH_DISCONNECT_TIMEOUT_MS),
        MATCH_CLEANUP_INTERVAL_MS: String(MATCH_CLEANUP_INTERVAL_MS),
        MATCH_TICK_MS: String(MATCH_TICK_MS),
      },
    });

    let ready = false;

    const onReject = (error) => {
      if (ready) return;
      clearTimeout(timeoutId);
      reject(error);
    };

    const onData = (data) => {
      const text = data.toString();
      if (ready) {
        return;
      }
      if (text.includes(`Match server listening on ws://localhost:${MATCH_PORT}`)) {
        ready = true;
        clearTimeout(timeoutId);
        resolve(server);
      }
    };

    const timeoutId = setTimeout(() => {
      if (ready) return;
      server.kill('SIGTERM');
      reject(new Error('match server did not start in time'));
    }, 3000);

    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('error', onReject);
    server.on('close', () => {
      if (!ready) onReject(new Error('match server exited before readiness'));
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    if (!server || server.exitCode !== null) {
      resolve();
      return;
    }

    server.once('exit', () => resolve());
    server.kill('SIGTERM');
    setTimeout(() => {
      if (server.exitCode === null) {
        server.kill('SIGKILL');
      }
    }, 300);
  });
}

function createSocket() {
  const url = `ws://127.0.0.1:${MATCH_PORT}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const cleanup = (fn) => {
      ws.removeAllListeners('open');
      ws.removeAllListeners('error');
      fn();
    };

    ws.once('open', () => cleanup(() => resolve(ws)));
    ws.once('error', (error) => cleanup(() => reject(error)));
  });
}

function closeSocket(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
      resolve();
      return;
    }

    ws.once('close', () => resolve());
    ws.close();
  });
}

function waitForMessage(ws, isMatch, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('message wait timed out'));
    }, timeoutMs);

    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (!isMatch(message)) {
        return;
      }
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    }

    ws.on('message', onMessage);
  });
}

function joinMatch(ws, matchId, playerId, sessionToken) {
  ws.send(JSON.stringify({
    type: NETWORK_MESSAGE_TYPE.JOIN,
    matchId,
    playerId,
    ...(sessionToken ? { sessionToken } : {}),
  }));
  return waitForMessage(
    ws,
    (msg) => msg.type === NETWORK_MESSAGE_TYPE.JOINED || msg.type === NETWORK_MESSAGE_TYPE.ERROR,
    2000,
  );
}

function send(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function commandSocket(ws, command, seq) {
  send(ws, {
    type: NETWORK_MESSAGE_TYPE.COMMAND,
    seq,
    command,
  });
}

function snapshotRequest(ws) {
  send(ws, { type: NETWORK_MESSAGE_TYPE.SNAPSHOT_REQUEST });
}

async function waitUntilMatchReclaim(matchId, playerId, timeoutMs = 1200, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastMessage;

  while (Date.now() < deadline) {
    const ws = await createSocket();
    try {
      const response = await joinMatch(ws, matchId, playerId);
      lastMessage = response;
      if (response.type === NETWORK_MESSAGE_TYPE.JOINED) {
        return { response, ws };
      }

      if (response.type === NETWORK_MESSAGE_TYPE.ERROR && response.message === NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR) {
        await closeSocket(ws);
        await delay(pollMs);
        continue;
      }

      throw new Error(response.message || 'unexpected join response');
    } catch (error) {
      await closeSocket(ws);
      throw error;
    }
  }

  throw new Error(`match was not reclaimed after ${timeoutMs}ms. lastMessage=${JSON.stringify(lastMessage)}`);
}

async function run() {
  const server = await connectServer();
  try {
    const matchId = `ws-churn-${Date.now()}`;

    const alicePrimary = await createSocket();
    const joinAlice = await joinMatch(alicePrimary, matchId, 'alice');
    assert.equal(joinAlice.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(joinAlice.side, 'left');

    const bob = await createSocket();
    const joinBob = await joinMatch(bob, matchId, 'bob');
    assert.equal(joinBob.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(joinBob.side, 'right');

    send(alicePrimary, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    send(bob, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    await waitForMessage(
      alicePrimary,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.STATE && msg.snapshot?.status === 'running',
      2000,
    );

    const aliceReplacement = await createSocket();
    const joinAliceReplacement = await joinMatch(aliceReplacement, matchId, 'alice', joinAlice.sessionToken);
    assert.equal(joinAliceReplacement.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(joinAliceReplacement.side, 'left');

    await closeSocket(alicePrimary);

    snapshotRequest(aliceReplacement);
    const afterCloseSnapshot = await waitForMessage(
      aliceReplacement,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.STATE && Boolean(msg.snapshot),
      2000,
    );
    assert.equal(afterCloseSnapshot.snapshot.players.left.connected, true);
    assert.equal(afterCloseSnapshot.snapshot.players.left.playerId, 'alice');

    const commandSeq = joinAliceReplacement.nextCommandSeq;
    commandSocket(
      aliceReplacement,
      {
        type: 'build',
        payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
      },
      commandSeq,
    );
    const commandAck = await waitForMessage(
      aliceReplacement,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.COMMAND_ACK && msg.seq === commandSeq,
      2000,
    );
    assert.equal(commandAck.seq, commandSeq);

    await closeSocket(aliceReplacement);
    await closeSocket(bob);

    const cleanupMatchId = `ws-cleanup-${Date.now()}`;
    const cleanupLeft = await createSocket();
    const cleanupRight = await createSocket();
    const joinLeft = await joinMatch(cleanupLeft, cleanupMatchId, 'left-player');
    assert.equal(joinLeft.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(joinLeft.side, 'left');

    const joinRight = await joinMatch(cleanupRight, cleanupMatchId, 'right-player');
    assert.equal(joinRight.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(joinRight.side, 'right');

    send(cleanupLeft, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    send(cleanupRight, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    await waitForMessage(
      cleanupLeft,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.STATE && msg.snapshot?.status === 'running',
      2000,
    );

    await closeSocket(cleanupLeft);
    await closeSocket(cleanupRight);

    const cleanupWait = MATCH_DISCONNECT_TIMEOUT_MS + MATCH_CLEANUP_INTERVAL_MS + 120;
    await delay(cleanupWait);

    const probe = await waitUntilMatchReclaim(
      cleanupMatchId,
      'cleanup-probe',
      1200,
      50,
    );
    assert.equal(probe.response.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(probe.response.side, 'left');
    await closeSocket(probe.ws);
    await closeSocket(alicePrimary);
    await closeSocket(bob);
    await closeSocket(aliceReplacement);
  } finally {
    await stopServer(server);
  }
}

async function runErrorCases() {
  const server = await connectServer();
  try {
    const unknownTypeMatch = `ws-unknown-type-${Date.now()}`;
    const unknownTypeClient = await createSocket();
    await joinMatch(unknownTypeClient, unknownTypeMatch, 'p1');
    send(unknownTypeClient, { type: 'does_not_exist' });
    const unknownTypeError = await waitForMessage(
      unknownTypeClient,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(unknownTypeError.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(unknownTypeError.message, formatUnknownMessage('does_not_exist'));
    await closeSocket(unknownTypeClient);
  } finally {
    await stopServer(server);
  }
}

async function runSessionTokenRequiredCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-session-token-${Date.now()}`;
    const left = await createSocket();
    const right = await createSocket();

    const joinLeft = await joinMatch(left, matchId, 'left-player');
    const joinRight = await joinMatch(right, matchId, 'right-player');
    assert.equal(joinLeft.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(joinRight.type, NETWORK_MESSAGE_TYPE.JOINED);

    await closeSocket(left);
    await closeSocket(right);

    const leftReplacement = await createSocket();
    const missingTokenError = await joinMatch(leftReplacement, matchId, 'left-player');
    assert.equal(missingTokenError.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(missingTokenError.message, NETWORK_MESSAGE_TEXT.SESSION_TOKEN_REQUIRED);
    await closeSocket(leftReplacement);

    const mismatchedToken = await createSocket();
    const mismatchError = await joinMatch(mismatchedToken, matchId, 'left-player', 'bad-token');
    assert.equal(mismatchError.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(mismatchError.message, NETWORK_MESSAGE_TEXT.SESSION_TOKEN_MISMATCH);
    await closeSocket(mismatchedToken);

    const validJoin = await createSocket();
    const valid = await joinMatch(validJoin, matchId, 'left-player', joinLeft.sessionToken);
    assert.equal(valid.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(valid.side, 'left');
    await closeSocket(validJoin);
  } finally {
    await stopServer(server);
  }
}

async function runInvalidJsonCase() {
  const server = await connectServer();
  try {
    const invalidJsonClient = await createSocket();
    const invalidJsonError = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        invalidJsonClient.off('message', onMessage);
        reject(new Error('message wait timed out'));
      }, 2000);

      function onMessage(raw) {
        const message = JSON.parse(raw.toString());
        if (message.type === NETWORK_MESSAGE_TYPE.ERROR) {
          clearTimeout(timer);
          invalidJsonClient.off('message', onMessage);
          resolve(message);
        }
      }
      invalidJsonClient.on('message', onMessage);
      invalidJsonClient.send('not-json');
    });
    assert.equal(invalidJsonError.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(invalidJsonError.message, NETWORK_MESSAGE_TEXT.INVALID_JSON);
    await closeSocket(invalidJsonClient);
  } finally {
    await stopServer(server);
  }
}

async function runTypeRequiredCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-type-required-${Date.now()}`;
    const client = await createSocket();
    const joined = await joinMatch(client, matchId, 'p1');
    assert.equal(joined.type, NETWORK_MESSAGE_TYPE.JOINED);

    send(client, {});
    const typeRequiredError = await waitForMessage(
      client,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(typeRequiredError.message, NETWORK_MESSAGE_TEXT.TYPE_REQUIRED);
    await closeSocket(client);
  } finally {
    await stopServer(server);
  }
}

async function runSeqRequiredCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-seq-required-${Date.now()}`;
    const client = await createSocket();
    const joined = await joinMatch(client, matchId, 'p1');
    assert.equal(joined.type, NETWORK_MESSAGE_TYPE.JOINED);

    send(client, {
      type: NETWORK_MESSAGE_TYPE.COMMAND,
      command: {
        type: 'build',
        payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
      },
    });
    const seqRequiredError = await waitForMessage(
      client,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(seqRequiredError.message, NETWORK_MESSAGE_TEXT.SEQ_REQUIRED);
    await closeSocket(client);
  } finally {
    await stopServer(server);
  }
}

async function runWaitingMatchCommandCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-waiting-command-${Date.now()}`;
    const left = await createSocket();
    const right = await createSocket();
    const leftJoin = await joinMatch(left, matchId, 'left-player');
    const rightJoin = await joinMatch(right, matchId, 'right-player');
    assert.equal(leftJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(leftJoin.side, 'left');
    assert.equal(rightJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(rightJoin.side, 'right');

    send(left, {
      type: NETWORK_MESSAGE_TYPE.COMMAND,
      seq: 1,
      command: {
        type: 'build',
        payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
      },
    });
    const waitingMatchError = await waitForMessage(
      left,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(waitingMatchError.message, NETWORK_MESSAGE_TEXT.MATCH_NOT_RUNNING);

    await closeSocket(left);
    await closeSocket(right);
  } finally {
    await stopServer(server);
  }
}

async function runCommandRequiredCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-command-required-${Date.now()}`;
    const client = await createSocket();
    const joined = await joinMatch(client, matchId, 'p1');
    assert.equal(joined.type, NETWORK_MESSAGE_TYPE.JOINED);
    await snapshotRequest(client);

    send(client, {
      type: NETWORK_MESSAGE_TYPE.COMMAND,
      seq: 1,
    });
    const commandRequiredError = await waitForMessage(
      client,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(commandRequiredError.message, NETWORK_MESSAGE_TEXT.COMMAND_REQUIRED);
    await closeSocket(client);
  } finally {
    await stopServer(server);
  }
}

async function runInvalidSeqCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-invalid-seq-${Date.now()}`;
    const client = await createSocket();
    const joined = await joinMatch(client, matchId, 'p1');
    assert.equal(joined.type, NETWORK_MESSAGE_TYPE.JOINED);

    send(client, {
      type: NETWORK_MESSAGE_TYPE.COMMAND,
      seq: 'not-an-integer',
      command: {
        type: 'build',
        payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
      },
    });
    const seqError = await waitForMessage(
      client,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(seqError.message, NETWORK_MESSAGE_TEXT.SEQ_REQUIRED);
    await closeSocket(client);
  } finally {
    await stopServer(server);
  }
}

async function runReadyRequiredCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-ready-required-${Date.now()}`;
    const client = await createSocket();
    const joined = await joinMatch(client, matchId, 'p1');
    assert.equal(joined.type, NETWORK_MESSAGE_TYPE.JOINED);

    send(client, {
      type: NETWORK_MESSAGE_TYPE.READY,
      ready: 'true',
    });
    const readyRequiredError = await waitForMessage(
      client,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(readyRequiredError.message, NETWORK_MESSAGE_TEXT.READY_REQUIRED);
    await closeSocket(client);
  } finally {
    await stopServer(server);
  }
}

async function runInvalidCommandTypeCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-invalid-command-type-${Date.now()}`;
    const left = await createSocket();
    const right = await createSocket();
    const leftJoin = await joinMatch(left, matchId, 'left-player');
    const rightJoin = await joinMatch(right, matchId, 'right-player');
    assert.equal(leftJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(rightJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    send(left, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    send(right, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    await waitForMessage(
      right,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.STATE && msg.snapshot?.status === 'running',
      2000,
    );

    send(left, {
      type: NETWORK_MESSAGE_TYPE.COMMAND,
      seq: 1,
      command: {
        type: 'teleport',
        payload: {
          side: 'left',
          x: 10,
          y: 1,
        },
      },
    });
    const invalidCommandError = await waitForMessage(
      left,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(invalidCommandError.message, NETWORK_MESSAGE_TEXT.INVALID_COMMAND);
    await closeSocket(left);
    await closeSocket(right);
  } finally {
    await stopServer(server);
  }
}

async function runMissingCommandTypeCase() {
  const server = await connectServer();
  try {
    const matchId = `ws-missing-command-type-${Date.now()}`;
    const left = await createSocket();
    const right = await createSocket();
    const leftJoin = await joinMatch(left, matchId, 'left-player');
    const rightJoin = await joinMatch(right, matchId, 'right-player');
    assert.equal(leftJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(rightJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    send(left, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    send(right, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    await waitForMessage(
      right,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.STATE && msg.snapshot?.status === 'running',
      2000,
    );

    send(left, {
      type: NETWORK_MESSAGE_TYPE.COMMAND,
      seq: 1,
      command: {},
    });
    const missingTypeError = await waitForMessage(
      left,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(missingTypeError.message, NETWORK_MESSAGE_TEXT.COMMAND_REQUIRED);
    await closeSocket(left);
    await closeSocket(right);
  } finally {
    await stopServer(server);
  }
}

async function runReadyStateTransitionCase() {
  const server = await connectServer();
  try {
    const readyMatchId = `ws-ready-transition-${Date.now()}`;
    const left = await createSocket();
    const right = await createSocket();
    const leftJoin = await joinMatch(left, readyMatchId, 'left-player');
    const rightJoin = await joinMatch(right, readyMatchId, 'right-player');

    assert.equal(leftJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(leftJoin.side, 'left');
    assert.equal(rightJoin.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(rightJoin.side, 'right');

    send(left, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    send(right, { type: NETWORK_MESSAGE_TYPE.READY, ready: true });
    const runningState = await waitForMessage(
      left,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.STATE && msg.snapshot?.status === 'running',
      2000,
    );
    assert.equal(runningState.snapshot?.players?.left?.ready, true);
    assert.equal(runningState.snapshot?.players?.right?.ready, true);
    await closeSocket(left);
    await closeSocket(right);
  } finally {
    await stopServer(server);
  }
}

async function runFullMatchCase() {
  const server = await connectServer();
  try {
    const fullMatchId = `ws-full-${Date.now()}`;
    const left = await createSocket();
    const right = await createSocket();
    const fullThird = await createSocket();
    const leftJoined = await joinMatch(left, fullMatchId, 'left-player');
    const rightJoined = await joinMatch(right, fullMatchId, 'right-player');
    assert.equal(leftJoined.type, NETWORK_MESSAGE_TYPE.JOINED);
    assert.equal(rightJoined.type, NETWORK_MESSAGE_TYPE.JOINED);
    const thirdJoin = await joinMatch(fullThird, fullMatchId, 'full-third');
    assert.equal(thirdJoin.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(thirdJoin.message, NETWORK_MESSAGE_TEXT.FULL_MATCH_ERROR);
    await closeSocket(left);
    await closeSocket(right);
    await closeSocket(fullThird);
  } finally {
    await stopServer(server);
  }
}

async function runJoinFirstCase() {
  const server = await connectServer();
  try {
    const joinFirstMatch = `ws-join-first-${Date.now()}`;
    const joinFirstClient = await createSocket();
    send(joinFirstClient, {
      type: NETWORK_MESSAGE_TYPE.READY,
      ready: true,
    });
    const joinFirstReadyError = await waitForMessage(
      joinFirstClient,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(joinFirstReadyError.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(joinFirstReadyError.message, NETWORK_MESSAGE_TEXT.JOIN_FIRST);

    send(joinFirstClient, {
      type: NETWORK_MESSAGE_TYPE.COMMAND,
      seq: 1,
      command: {
        type: 'build',
        payload: { side: 'left', buildingTypeId: 'barracks', slotIndex: 0 },
      },
    });
    const joinFirstCommandError = await waitForMessage(
      joinFirstClient,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(joinFirstCommandError.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(joinFirstCommandError.message, NETWORK_MESSAGE_TEXT.JOIN_FIRST);
    await closeSocket(joinFirstClient);
  } finally {
    await stopServer(server);
  }
}

async function runSnapshotFirstCase() {
  const server = await connectServer();
  try {
    const snapshotFirstClient = await createSocket();
    send(snapshotFirstClient, { type: NETWORK_MESSAGE_TYPE.SNAPSHOT_REQUEST });
    const errorMessage = await waitForMessage(
      snapshotFirstClient,
      (msg) => msg.type === NETWORK_MESSAGE_TYPE.ERROR,
      2000,
    );
    assert.equal(errorMessage.type, NETWORK_MESSAGE_TYPE.ERROR);
    assert.equal(errorMessage.message, NETWORK_MESSAGE_TEXT.JOIN_FIRST);
    await closeSocket(snapshotFirstClient);
  } finally {
    await stopServer(server);
  }
}

runTest('match server handles stale disconnects and cleanup', run)
  .then(() => runTest('match server rejects unknown message type', runErrorCases))
  .then(() => runTest('match server returns invalid json error', runInvalidJsonCase))
  .then(() => runTest('match server validates required message type', runTypeRequiredCase))
  .then(() => runTest('match server validates command sequence', runSeqRequiredCase))
  .then(() => runTest('match server rejects command while waiting', runWaitingMatchCommandCase))
  .then(() => runTest('match server validates required command payload', runCommandRequiredCase))
  .then(() => runTest('match server validates command sequence integer type', runInvalidSeqCase))
  .then(() => runTest('match requires session token for existing player rejoin', runSessionTokenRequiredCase))
  .then(() => runTest('match server validates ready boolean', runReadyRequiredCase))
  .then(() => runTest('match server rejects invalid command type', runInvalidCommandTypeCase))
  .then(() => runTest('match server rejects missing command type', runMissingCommandTypeCase))
  .then(() => runTest('match starts when both players ready', runReadyStateTransitionCase))
  .then(() => runTest('match server rejects pre-join snapshot request', runSnapshotFirstCase))
  .then(() => runTest('match server enforces match player limit', runFullMatchCase))
  .then(() => runTest('match server rejects pre-join state commands', runJoinFirstCase))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

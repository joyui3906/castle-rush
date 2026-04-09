# Castle Rush Handoff (2026-04-09)

## 1. Project Status
- Current goal: single-lane prototype with build/auto-battle loop, now extended toward 1v1 network-ready architecture.
- Tech: vanilla JS modules (no framework), static HTML/CSS, deterministic tick simulation core.
- Current branch context: `main`.

## 2. What Is Implemented

### 2.1 Core Gameplay
- Single lane battle simulation with:
  - 2 castles (`left`, `right`)
  - gold income
  - build/sell actions
  - auto spawn, auto combat, win/lose
- Units can attack:
  - enemy units
  - enemy buildings (if no unit target in range)
- Building destruction:
  - each building type has `maxHp`
  - destroyed building clears slot and stops spawning

### 2.2 Building System (Slot-Based)
- No starting buildings by default.
- Each side has 10 fixed build slots (`2 x 5` layout) with explicit `(x, y)` coordinates.
- Build requires:
  - enough gold
  - selected slot empty
- Sell:
  - selected slot building removed
  - refund by `goldIncome.sellRefundRatio` (default 0.6)

### 2.3 2D Wide-Road Model
- Lane is 1 lane with continuous width (`y`) instead of discrete top/mid/bot tracks.
- Movement/combat uses 2D distance.
- Units sidestep in `y` when blocked (combat priority preserved).

### 2.4 UI / Visualization
- ASCII battlefield view with:
  - castles (`L`/`R`)
  - buildings (`B`/`b`)
  - selected slots (`H`/`h`, `O`)
  - empty slots (`o`)
  - units (`upper/lower`, `*` stack)
- Build controls:
  - visual slot mini-map (clickable points)
  - selected slot based build/sell
- Controls are no longer rerendered each tick (prevents selection reset).

### 2.5 Networking Foundation (1v1)
- WebSocket match server added.
- Authoritative server tick model:
  - players join left/right
  - ready state
  - command queue processed on server tick
- Client network mode:
  - enabled via URL query `?net=1`
  - connect/join/ready/command/snapshot flows
- Command sequence handling:
  - per-player monotonic `seq`
  - duplicate `seq` (`== lastAcceptedSeq`) treated idempotently (ack-loss safe)
  - lower `seq` rejected
- Client transport/error text and network player status labels are now also centralized in `src/net/network-messages.js`:
  - `SOCKET_CONNECTION_FAILED`, `INVALID_MESSAGE_PAYLOAD`
  - player readiness/connection labels used by UI HUD
- Message protocol string literals (`join`/`ready`/`command`/`snapshot_request`/`error` etc.) are now centralized as `NETWORK_MESSAGE_TYPE` and consumed by client/server/tests.
- Reconnect behavior:
  - same `playerId` rejoins same side
  - server returns `nextCommandSeq`
  - client auto-reconnect with exponential backoff on unexpected disconnects (8 attempts max)
  - explicit state-transition helpers now centralize offline/connected/joined/full-match transitions in `src/main.js`
  - reconnect attempt start/failure transitions are now shared (`beginNetworkConnectAttempt`, `markNetworkReconnectAttemptFailed`) to keep banner/error behavior consistent
  - offline fallback now keeps reason-visible banners by default unless explicitly suppressed
  - command reject reasons are propagated from server for targeted resync
  - network UI copy and match phase states are centralized in `src/net/network-messages.js` and consumed by `src/main.js`/`src/ui/controls.js`
  - server command/handshake error messages and command-reject reason values now flow from shared constants in `src/net/network-messages.js`

## 3. Key Files (Entry Points)
- Frontend entry: `src/main.js`
- Simulation core: `src/core/sim.js`
- Match abstraction: `src/core/match.js`
- Optional engine wrapper: `src/core/engine.js`
- Network client: `src/net/match-client.js`
- Network message constants/helpers: `src/net/network-messages.js`
- UI controls: `src/ui/controls.js`
- Renderer: `src/render/render.js`
- Game data/balance: `src/data/game-data.js`
- Match server: `server/match-server.mjs`

## 4. Runbook

### 4.1 Install
```powershell
npm install
```

### 4.2 Static Client
```powershell
npm run dev:static
```
- default: `http://localhost:8080`
- if port conflict:
```powershell
$env:PORT=8081; npm run dev:static
```

### 4.3 Match Server
```powershell
npm run server:match
```
- default WS: `ws://localhost:8787`
- state transport: periodic full `state` plus delta `stateDelta`
- config: `MATCH_FULL_STATE_EVERY_TICKS` (default `12`)
- optional auth guard: set `MATCH_AUTH_TOKEN` to require matching token on `join`
- cleanup: remove matches with no connected players after `MATCH_DISCONNECT_TIMEOUT_MS` (default `300000`)
- cleanup interval: `MATCH_CLEANUP_INTERVAL_MS` (default `15000`)

### 4.4 Local 1v1 Browser Test
- Tab A:
  - `http://localhost:8080/?net=1&matchId=room-1&playerId=alice`
- Tab B:
  - `http://localhost:8080/?net=1&matchId=room-1&playerId=bob`
  - if token is enabled, append `&matchAuthToken=<token>`
- In each tab:
  - `Connect` -> `Ready`

## 5. Test Commands
- Simulation tests:
```powershell
npm run test:sim
```
- Match tests:
```powershell
npm run test:match
```
- Network match tests:
```powershell
npm run test:match:ws
```
- 실행 환경에 따라 로컬 포트 바인딩 제한이 있어, 샌드박스 외부에서 재실행이 필요할 수 있습니다.
- Current `scripts/test-match-ws.mjs` coverage:
  - stale disconnect reclaim + reconnect to reclaim-side
  - unknown message type rejection
  - invalid JSON message handling
  - command validation failures (missing `type`, missing `seq`, invalid `seq`, missing `command`)
  - command rejected before match start (`MATCH_NOT_RUNNING`)
  - ready-to-running transition validation (`ready` both sides -> `running`)
  - pre-join `snapshot_request` rejection (`JOIN_FIRST`)
  - full match (third player) rejection
  - pre-join `ready`/`command` rejection
- Match local demo:
```powershell
node scripts/match-local-demo.mjs
```
- Aggregate sim report:
```powershell
node scripts/sim-report.mjs
```

## 6. Current Known Behavior / Constraints
- In network mode, state is server-driven; local tick loop is disabled.
- Controls in network mode gate side-bound actions to own side.
- Baseline empty-start scenario naturally draws unless players build.
- Network updates use mixed mode: periodic full `state` + in-between `stateDelta`.
- Match cleanup is periodic for matches with no connected sockets/players.
- Network status flow in `src/main.js` now uses `NETWORK_PHASE` + shared network text helpers for consistent UI states and banners (`full`, `running`, `offline`, etc.).
- Network UI now tracks match phase (`waiting`, `running`, `finished`) and shows player readiness/connection in HUD.
- `match is full` 상태는 별도 `matchPhase: 'full'`로 처리되어 자동 재접속 대상에서 제외된다.
- Reconnect countdown now uses a dedicated state helper (`setReconnectCountdown`) and auto-clears stale countdown state on expiry.
- `full` 상태에서도 `Connect` 버튼을 `Retry`로 노출해 수동 재시도 UX를 허용한다.

## 7. Open TODO (Recommended Next Steps)
1. Security hardening
- simple auth/session token instead of raw `playerId`.

2. Multiplayer client UX
- lobby phase UI separation (`waiting`, `running`, `finished`). (partially implemented in network controls)

3. Network tuning
- benchmark payload sizes and tune `MATCH_FULL_STATE_EVERY_TICKS`.
4. Network UX/state polish
- review remaining reconnect/error banner messages for consistent user feedback across manual disconnect vs network faults
- ensure reconnect/reconnect-fail banner messages are reflected in UI even under repeated auto-retry cycles
- Add explicit guard helper (`isMatchPhaseFull`) for all full-match gating points before command/ready/snapshot dispatch (done)
- command/server-error banner updates now funnel through `setNetworkTransientBanner(...)` in `src/main.js`
- network action guard now uses `canPerformNetworkAction()` for ready/snapshot/command paths (offline/full/manual-safe)
- command dispatch path now requires `RUNNING` match phase via `canSendNetworkCommand()` in `src/main.js`, preventing pre-start command spam and reducing server-side error churn
- Ready state mutation now flows through `setNetworkReadyState(nextReady)` for auto-ready and manual toggle consistency
- successful snapshot transitions clear transient banners to keep connect/join/snapshot message flow clean

## 8. Message Protocol (Current)

### Client -> Server
- `join`: `{ type: "join", matchId, playerId, authToken? }`
- `ready`: `{ type: "ready", ready: boolean }`
- `command`: `{ type: "command", seq: number, command: {...} }`
- `snapshot_request`: `{ type: "snapshot_request" }`

### Server -> Client
- `hello`
- `joined`: includes `side`, `nextCommandSeq`
- `command_ack`: includes `seq`
- `state`: includes
  - `snapshot`
  - `state` (full snapshot payload, sent periodically)
  - `stateDelta` (delta payload for non-snapshot ticks)
- `error`: includes `message` (and optional `seq`)

## 9. Notes for Next Model
- Prefer adding features through command model (`enqueueCommand`) rather than direct state mutation.
- Keep deterministic behavior unless explicitly deciding otherwise.
- Respect AGENTS.md constraints: small scoped changes, minimal dependencies, readable architecture.

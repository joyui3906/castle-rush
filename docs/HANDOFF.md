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
- Reconnect behavior:
  - same `playerId` rejoins same side
  - server returns `nextCommandSeq`

## 3. Key Files (Entry Points)
- Frontend entry: `src/main.js`
- Simulation core: `src/core/sim.js`
- Match abstraction: `src/core/match.js`
- Optional engine wrapper: `src/core/engine.js`
- Network client: `src/net/match-client.js`
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

### 4.4 Local 1v1 Browser Test
- Tab A:
  - `http://localhost:8080/?net=1&matchId=room-1&playerId=alice`
- Tab B:
  - `http://localhost:8080/?net=1&matchId=room-1&playerId=bob`
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
- Full-state broadcast is currently used (no delta compression yet).

## 7. Open TODO (Recommended Next Steps)
1. Network payload optimization
- move from full-state every tick to periodic snapshot + delta.

2. Reconnect UX finalization
- explicit reconnect banner + optional auto-ready policy toggle.

3. Server robustness
- match cleanup timeout for abandoned rooms.
- explicit disconnect/rejoin test cases with socket churn.

4. Security hardening
- simple auth/session token instead of raw `playerId`.

5. Multiplayer client UX
- lobby phase UI separation (`waiting`, `running`, `finished`).

## 8. Message Protocol (Current)

### Client -> Server
- `join`: `{ type: "join", matchId, playerId }`
- `ready`: `{ type: "ready", ready: boolean }`
- `command`: `{ type: "command", seq: number, command: {...} }`
- `snapshot_request`: `{ type: "snapshot_request" }`

### Server -> Client
- `hello`
- `joined`: includes `side`, `nextCommandSeq`
- `command_ack`: includes `seq`
- `state`: includes `snapshot` + full `state`
- `error`: includes `message` (and optional `seq`)

## 9. Notes for Next Model
- Prefer adding features through command model (`enqueueCommand`) rather than direct state mutation.
- Keep deterministic behavior unless explicitly deciding otherwise.
- Respect AGENTS.md constraints: small scoped changes, minimal dependencies, readable architecture.

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

### 6.1 Network checkpoint (2026-04-10)
- 네트워크는 네트워크 쪽 UX/재연결/세션 토큰 보존 흐름을 중심으로 현재 상태를 기록으로 둔 뒤, 이번 구간에서는 오프라인 전투/게임플레이 개선으로 이동함.
- 네트워크는 기존 상태 분기( `full`/`error`/`offline` ) 유지, 자동 재접속은 수동 전환점은 건드리지 않고 재사용.
- `sessionToken` 요구/불일치/교체 메시지 케이스는 기존 핸들러에 반영해 토큰 유지 정책을 통일 처리.

### 6.2 Single-player local mode (진행중)
- `?single=1` 또는 `?solo=1`로 진입하면 로컬 싱글 모드가 활성화됨.
- `?single`/`?solo` 플래그가 파라미터로 존재하면 값과 무관하게 싱글 모드가 활성화됨.
- `humanSide=left|right` 쿼리로 조작 측을 지정할 수 있음(`humanSide=left` 기본).
- `aiProfile=econ|balanced|aggressive`로 AI 빌드 성향을 선택할 수 있음(`balanced` 기본).
  - `econ`: 초반부터 수익 건물을 더 많이 깔아 확장 기반을 만듦 (`income_mine` 목표 4개)
  - `balanced`: 수익/군사 건물 균형 유지
  - `aggressive`: 초반 군사 건물을 더 빠르게 쌓아 압박을 우선시 (`barracks` 목표 4개, `splash_tower` 목표 3개)
- 싱글 모드에서는 조작 측이 아닌 편은 AI가 고정 큐 + 폴백 규칙으로 빌드 진행.
- 자동 빌드/수동 빌드 정책은 `src/main.js`의 `SINGLE_PLAYER_AI_PLAN`과 `runSinglePlayerAIActions`/`getSinglePlayerAiFallbackType`으로 조정 가능.
- 실행 예시
  - `/?single`
  - `/?solo&humanSide=right&aiProfile=aggressive`

### 6.3 Visualization pass (진행중)
- 렌더 화면에 다음 지표를 추가해 가독성 개선
  - AI 프로필/남은 스크립트 단계 표시
  - 좌우 성능 게이지(HP/유닛 수) 기반 텍스트 바
  - 경기 상태 카드에 상태/시간/큐/위상 요약
  - ASCII 전장 legend 문구 정리
  - 골드 수급/소모 미니 타임라인 추가(최근 10틱): 좌우 라인으로 +/− 변화량 시각화

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

## 9. Work Log (2026-04-10)
- 오늘 진행(네트워크/승패체감/밸런스)
  - 폭격(일회성 전역 스킬) 기능을 네트워크/오프라인 흐름에서 이어서 정리.
  - `src/ui/controls.js`에서 네트워크 모드 폭격 버튼 클릭 시 낙관적 즉시 반응 적용:
    - 명령 전송 성공 시 로컬 상태로 `nukeUsed` 즉시 갱신
    - `nukeEffect` 즉시 표시
    - 상대 진영 유닛 `hp`를 즉시 제거해 화면에 즉시 반영
  - `src/core/sim.js` 및 `src/main.js`는 네트워크 스냅샷/델타에서 폭격 상태 반영을 유지해 정합성 확보.
  - 렌더 쪽은 `src/render/render.js`에서 폭격 연출/최근 이벤트 표시 연계가 이미 적용된 상태를 확인.
  - 유저 체감상 궁수(Building) 중심 빌드가 과도하게 강했으나, 유닛 직접 스탯 수정은 요청대로 보류.
  - 대신 건물 레벨 보정으로만 조정:
    - `src/data/game-data.js` `range_tower`  
      - `cost: 90 → 100`
      - `spawnEveryTicks: 6 → 7`
  - 테스트는 이번 세션에서 실행하지 않음(변경 사항 반영 후 다음 세션에서 샘플 매치 검증 권장).
  - 현재까지의 오픈 이슈: 궁수 과강함 체감이 완전 해소되지 않을 수 있어 추가 튜닝은 샘플 매치 피드백 기반으로 1~2 단계만 진행 예정.

## 10. Notes for Next Model
- Prefer adding features through command model (`enqueueCommand`) rather than direct state mutation.
- Keep deterministic behavior unless explicitly deciding otherwise.
- Respect AGENTS.md constraints: small scoped changes, minimal dependencies, readable architecture.

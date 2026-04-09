# AGENTS.md

## Project goal
This project is a modern remake-inspired auto battle lane strategy game influenced by Warcraft 3 Castle Fight.

## Product rules
- Keep scope small.
- Prioritize a playable prototype over polished UI.
- The first milestone is a single-lane offline battle simulator.
- Do not add matchmaking, ranking, login, payment, or live multiplayer in early milestones.
- Prefer deterministic combat logic where possible.

## Tech rules
- Use simple, readable architecture.
- Keep dependencies minimal.
- Separate game data from rendering logic.
- Prefer small commits and scoped changes.

## Workflow rules
- Before large changes, explain the plan briefly.
- After changes, summarize what changed, what remains, and how to run it.
- Run available tests or basic validation after implementation.
- If something is uncertain, state assumptions clearly instead of inventing details.

## Current milestone
Build an MVP with:
- 1 lane
- 2 castles
- gold resource
- 4 building types
- 6 unit types
- auto-spawn
- auto-battle
- win/lose condition

## Handoff anchor (read first before coding)
- Canonical handoff doc: `docs/HANDOFF.md`
- If there is conflict between this file and `docs/HANDOFF.md`, follow `docs/HANDOFF.md` for current implementation details.

## Current implementation snapshot (2026-04-09)
- Simulation is now a 2D wide-road model (`x` forward, continuous `y` width), still conceptually 1 lane.
- Building system is slot-based:
  - each side has 10 fixed slots with explicit `(x,y)` coordinates
  - empty start (no starting buildings)
  - build/sell on selected slot
- Units can attack enemy units and enemy buildings.
- Building HP/destruction is implemented; destroyed buildings clear slots and stop spawning.
- UI has:
  - ASCII battlefield
  - clickable slot mini-map for visual build placement
  - network panel for connect/ready/snapshot in multiplayer mode
- Networking foundation exists:
  - authoritative match loop in core
  - WebSocket match server
  - browser network mode via URL `?net=1`
  - per-player command `seq` checks with duplicate-idempotent handling
  - same `playerId` reconnect restores side

## Runtime modes
- Local single mode:
  - `http://localhost:8080/`
- Network client mode:
  - `http://localhost:8080/?net=1&matchId=room-1&playerId=alice`

## Run commands
- Install deps: `npm install`
- Static client: `npm run dev:static`
- Match server: `npm run server:match`
- Sim tests: `npm run test:sim`
- Match tests: `npm run test:match`
- Aggregate report: `node scripts/sim-report.mjs`

## Files to inspect first for future work
- `src/main.js` (mode switch local vs network client)
- `src/core/sim.js` (deterministic combat/build/sell/core state)
- `src/core/match.js` (authoritative 1v1 match abstraction)
- `server/match-server.mjs` (WebSocket protocol/tick broadcast)
- `src/ui/controls.js` (slot UI + network controls)
- `src/render/render.js` (ASCII visualization)

## Network protocol (current minimal contract)
- Client -> server:
  - `join { matchId, playerId }`
  - `ready { ready }`
  - `command { seq, command }`
  - `snapshot_request {}`
- Server -> client:
  - `hello`
  - `joined { side, nextCommandSeq }`
  - `command_ack { seq }`
  - `state { snapshot, state }`
  - `error { message, seq? }`

## Continuation guidance for next model
- Prefer command-model changes (`enqueueCommand`) over direct state mutation.
- Preserve deterministic behavior unless an explicit product decision says otherwise.
- Keep scope small and iterate with tests/scripts in `scripts/` before adding large UI/network complexity.

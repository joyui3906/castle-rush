# Gameplay Review (Current Prototype)

## Scope reviewed
- `src/data/game-data.js`
- `src/core/sim.js`
- `src/render/render.js`
- deterministic simulation run from Node

## Findings

### 1) Snowball risks
1. **No comeback pressure once a side wins lane control.**
   - Units only move forward and never retreat/reposition, so an advantage tends to compound until castle contact.
   - Relevant logic: movement + castle-hit removal cycle (`moveTowardEnemyCastle`, `applyCastleDamageFromReachedUnits`).
2. **Economy has no spending sink yet.**
   - Gold grows forever and cannot be converted into strategic choices, so there is no economic recovery decision.

### 2) Boring states
1. **Early match has repetitive cadence.**
   - Same buildings auto-spawn on fixed intervals every game.
2. **Mid-lane stalemates can become passive watching.**
   - Units stand and trade with no ability usage, targeting variety, or pacing shifts.

### 3) Dominant strategies
1. **Current default setup is effectively solved.**
   - With current starting buildings and stats, left side wins every run tested (3/3) at tick 287 with 1000 HP remaining.
2. **Static openings dominate.**
   - Starting buildings are fixed and asymmetrical, and there are no player actions to counter or adapt.

### 4) Unclear feedback
1. **No lane-front visualization.**
   - UI shows sample unit text, but not a clear front line or pressure swing.
2. **No event feedback for damage spikes.**
   - Castle hits and unit deaths are not surfaced as explicit events.
3. **No reason display for winner.**
   - End state says winner but not whether by castle destruction or max tick tie-break.

## Smallest gameplay changes to improve feel (proposed)

1. **Add tiny spawn jitter by side/building (+/- 1 tick deterministic offset).**
   - Keep deterministic by deriving offset from `buildingTypeId + side` hash.
   - Effect: breaks perfect wave mirroring and reduces solved outcomes with minimal code.

2. **Add "castle defense zone" bonus near each castle (+2 attack within last 15 lane units).**
   - Effect: creates comeback friction and slows hard snowball at the gate.

3. **Add one low-cost fallback spawn when castle HP < 40% (every 10 ticks).**
   - Example: auto-spawn `spearman` for the losing side only.
   - Effect: introduces comeback moments without adding UI/build controls yet.

4. **Expose a compact event log of last 5 events in renderer.**
   - Events: unit spawned, unit killed, castle hit, winner reason.
   - Effect: much clearer feedback while keeping render simple.

5. **Show lane pressure metric in UI:**
   - `pressure = avg(left unit position) - avg(right unit position)` (or alive-count delta).
   - Effect: makes "who is pushing" immediately readable.

## Why these are minimal
- No backend or networking changes.
- No new dependencies.
- No change to core architecture (data/sim/render separation remains).
- Each item can be implemented incrementally in small commits.

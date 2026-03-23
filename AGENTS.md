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

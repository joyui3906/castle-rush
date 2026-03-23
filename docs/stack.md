# Minimal stack recommendation

## Recommended stack
- HTML + CSS + modern JavaScript (ES modules)
- Optional dev server: `npx serve .` or `python -m http.server`
- No backend, database, auth, payments, ranking, or multiplayer

## Why this is minimal and sufficient
1. **Smallest possible browser runtime**: runs in any modern browser without build tooling.
2. **Fast iteration**: one lane, two castles, and deterministic tick logic are easy to tweak in plain JS.
3. **Clear architecture**: data (`src/data`), simulation (`src/core`), and rendering (`src/render`) are separated.
4. **Low dependency risk**: no framework lock-in and minimal setup friction for MVP experimentation.

## When to add more tooling later
Only after MVP battle feel is validated (spawn/combat/economy):
- Add TypeScript for safer refactors.
- Add a tiny bundler only if modules/assets become hard to manage.

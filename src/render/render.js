function summarizeUnitsBySide(state) {
  const summary = {
    left: 0,
    right: 0,
  };

  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units[unitId];
    if (!unit) continue;
    summary[unit.side] += 1;
  }

  return summary;
}

function listLeadingUnits(state) {
  const units = state.battleLane.unitIds
    .map((id) => state.units[id])
    .filter(Boolean)
    .sort((a, b) => (a.side === 'left' ? b.position - a.position : a.position - b.position))
    .slice(0, 6);

  if (units.length === 0) return 'none';

  return units
    .map((unit) => `${unit.id}:${unit.side}:${unit.typeId}@${unit.position.toFixed(0)}(hp:${unit.hp})`)
    .join(', ');
}

export function render(root, state, data) {
  if (!root) return;

  const { left, right } = state.castles;
  const unitSummary = summarizeUnitsBySide(state);

  root.innerHTML = `
    <h2>Single-Lane Battle Simulator</h2>
    <p>Time: ${Math.floor(state.timeMs / 1000)}s (tick ${state.tick})</p>
    <p>Lane: ${data.battleLane.id} / length ${data.battleLane.length}</p>

    <h3>Castles</h3>
    <ul>
      <li>${left.name}: HP ${Math.max(0, left.hp)}/${left.maxHp}, Gold ${left.gold}, Buildings ${left.buildings.join(', ')}</li>
      <li>${right.name}: HP ${Math.max(0, right.hp)}/${right.maxHp}, Gold ${right.gold}, Buildings ${right.buildings.join(', ')}</li>
    </ul>

    <h3>Units</h3>
    <p>Alive - Left: ${unitSummary.left}, Right: ${unitSummary.right}</p>
    <p>Sample units: ${listLeadingUnits(state)}</p>

    <h3>Result</h3>
    <p>Winner: ${state.winner ?? 'in progress'}</p>
  `;
}

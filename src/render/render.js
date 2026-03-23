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

function listAliveUnitsBySide(state, side) {
  return state.battleLane.unitIds
    .map((id) => state.units[id])
    .filter((unit) => unit && unit.side === side)
    .sort((a, b) => a.position - b.position)
    .map((unit) => `${unit.id}:${unit.typeId}@${unit.position.toFixed(0)}(hp:${unit.hp})`);
}

export function render(root, state, data) {
  if (!root) return;

  const { left, right } = state.castles;
  const unitSummary = summarizeUnitsBySide(state);
  const leftUnits = listAliveUnitsBySide(state, 'left');
  const rightUnits = listAliveUnitsBySide(state, 'right');
  const feedback = state.events ?? [];

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
    <p>Left units: ${leftUnits.length > 0 ? leftUnits.join(', ') : 'none'}</p>
    <p>Right units: ${rightUnits.length > 0 ? rightUnits.join(', ') : 'none'}</p>

    <h3>Result</h3>
    <p>Winner: ${state.winner ?? 'in progress'}</p>

    <h3>Feedback Log (latest 5)</h3>
    <ul>
      ${feedback.length > 0 ? feedback.map((event) => `<li>${event}</li>`).join('') : '<li>none</li>'}
    </ul>
  `;
}

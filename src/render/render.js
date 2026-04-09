import { inspectUnit } from '../core/sim.js';

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

function summarizeBuildings(buildings) {
  const counts = new Map();
  for (const slot of buildings) {
    if (!slot.buildingTypeId) continue;
    counts.set(slot.buildingTypeId, (counts.get(slot.buildingTypeId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([id, count]) => `${id} x${count}`)
    .join(', ');
}

function getSlotSummary(castle, selectedSlotIndex) {
  const slot = castle?.slots?.[selectedSlotIndex ?? -1];
  if (!slot) return 'none';
  const occupancy = slot.buildingTypeId ? `${slot.buildingTypeId} (hp:${Math.max(0, Math.round(slot.buildingHp))})` : 'empty';
  return `#${slot.index} @ x ${slot.x}, y ${slot.y} - ${occupancy}`;
}

function getUnitSymbol(unit) {
  const symbolByType = {
    swordsman: 'S',
    archer: 'A',
    guardian: 'G',
    spearman: 'P',
    scout: 'C',
    mage: 'M',
  };

  const base = symbolByType[unit.typeId] ?? 'U';
  return unit.side === 'left' ? base : base.toLowerCase();
}

function buildBattlefieldAscii(state, data) {
  const boardColumns = 51;
  const laneLength = data.battleLane.length;
  const movement = data.combat?.movement ?? {};
  const roadHalfWidth = movement.roadHalfWidth ?? 6;
  const rowCount = movement.asciiRows ?? 9;
  const rows = Array.from({ length: rowCount }, () => Array.from({ length: boardColumns }, () => '.'));
  const maxColumn = boardColumns - 1;

  for (const row of rows) {
    row[0] = 'L';
    row[maxColumn] = 'R';
  }

  for (const side of ['left', 'right']) {
    const castle = state.castles[side];
    const selectedSlotIndex = state.ui?.selectedBuildSlotBySide?.[side];
    for (const slot of castle.slots ?? []) {
      const normalizedY = (Math.max(-roadHalfWidth, Math.min(roadHalfWidth, slot.y)) + roadHalfWidth) / (roadHalfWidth * 2);
      const rowIndex = Math.max(0, Math.min(rowCount - 1, rowCount - 1 - Math.round(normalizedY * (rowCount - 1))));
      const clampedPosition = Math.max(0, Math.min(laneLength, slot.x));
      const column = Math.round((clampedPosition / laneLength) * maxColumn);
      const current = rows[rowIndex][column];
      if (current === 'L' || current === 'R') continue;
      const isSelected = selectedSlotIndex === slot.index;
      if (slot.buildingTypeId) {
        if (isSelected) {
          rows[rowIndex][column] = side === 'left' ? 'H' : 'h';
        } else {
          rows[rowIndex][column] = side === 'left' ? 'B' : 'b';
        }
      } else if (current === '.') {
        rows[rowIndex][column] = isSelected ? 'O' : 'o';
      }
    }
  }

  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units[unitId];
    if (!unit) continue;

    const normalizedY = (Math.max(-roadHalfWidth, Math.min(roadHalfWidth, unit.y)) + roadHalfWidth) / (roadHalfWidth * 2);
    const rowIndex = Math.max(0, Math.min(rowCount - 1, rowCount - 1 - Math.round(normalizedY * (rowCount - 1))));

    const clampedPosition = Math.max(0, Math.min(laneLength, unit.position));
    const column = Math.round((clampedPosition / laneLength) * maxColumn);
    const current = rows[rowIndex][column];
    if (current === 'L' || current === 'R') continue;

    const symbol = getUnitSymbol(unit);
    rows[rowIndex][column] = current === '.' ? symbol : '*';
  }

  const axis = `x: 0${' '.repeat(20)}50${' '.repeat(19)}100`;
  const boardLines = rows.map((row, index) => {
    const ratio = (rowCount - 1 - index) / (rowCount - 1 || 1);
    const y = (ratio * roadHalfWidth * 2) - roadHalfWidth;
    return `y=${y.toFixed(1).padStart(4, ' ')} |${row.join('')}|`;
  });
  const legend = 'Legend: L/R castle, H/h selected building slot, O selected empty slot, B/b building, o empty slot, Upper/lower units by side, *=stacked';

  return `${axis}\n${boardLines.join('\n')}\n${legend}`;
}

function calculatePressure(state, data) {
  const leftUnits = state.battleLane.unitIds
    .map((id) => state.units[id])
    .filter((unit) => unit && unit.side === 'left');
  const rightUnits = state.battleLane.unitIds
    .map((id) => state.units[id])
    .filter((unit) => unit && unit.side === 'right');

  const leftAvg = leftUnits.length > 0
    ? leftUnits.reduce((sum, unit) => sum + unit.position, 0) / leftUnits.length
    : data.battleLane.leftCastlePosition;
  const rightAvg = rightUnits.length > 0
    ? rightUnits.reduce((sum, unit) => sum + unit.position, 0) / rightUnits.length
    : data.battleLane.rightCastlePosition;

  const delta = leftAvg - (data.battleLane.length - rightAvg);
  let trend = 'neutral';
  if (delta > 5) trend = 'left pressure';
  else if (delta < -5) trend = 'right pressure';

  return { leftAvg, rightAvg, delta, trend };
}

export function render(root, state, data) {
  if (!root) return;

  const { left, right } = state.castles;
  const unitSummary = summarizeUnitsBySide(state);
  const feedback = state.events ?? [];
  const pressure = calculatePressure(state, data);
  const battlefieldAscii = buildBattlefieldAscii(state, data);
  const leftBuildings = summarizeBuildings(left.slots ?? []);
  const rightBuildings = summarizeBuildings(right.slots ?? []);
  const selectedLeftSlot = getSlotSummary(left, state.ui?.selectedBuildSlotBySide?.left);
  const selectedRightSlot = getSlotSummary(right, state.ui?.selectedBuildSlotBySide?.right);
  const selectedUnit = state.debug?.selectedUnitId ? inspectUnit(state, data, state.debug.selectedUnitId) : null;

  root.innerHTML = `
    <h2>Single-Lane Battle Simulator</h2>
    <div class="status-grid">
      <section class="status-card">
        <h3>Match</h3>
        <p>Time: ${Math.floor(state.timeMs / 1000)}s (tick ${state.tick})</p>
        <p>Lane: ${data.battleLane.id} / length ${data.battleLane.length}</p>
        <p>Road width: y ${-(data.combat?.movement?.roadHalfWidth ?? 6)} ~ +${data.combat?.movement?.roadHalfWidth ?? 6}</p>
      </section>
      <section class="status-card">
        <h3>Castles</h3>
        <p>${left.name}: HP ${Math.max(0, left.hp)}/${left.maxHp}, Gold ${left.gold}</p>
        <p>Buildings (L): ${leftBuildings || 'none'}</p>
        <p>Slots (L): ${(left.slots ?? []).filter((slot) => slot.buildingTypeId).length}/${(left.slots ?? []).length}</p>
        <p>Selected Slot (L): ${selectedLeftSlot}</p>
        <p>${right.name}: HP ${Math.max(0, right.hp)}/${right.maxHp}, Gold ${right.gold}</p>
        <p>Buildings (R): ${rightBuildings || 'none'}</p>
        <p>Slots (R): ${(right.slots ?? []).filter((slot) => slot.buildingTypeId).length}/${(right.slots ?? []).length}</p>
        <p>Selected Slot (R): ${selectedRightSlot}</p>
      </section>
      <section class="status-card">
        <h3>Units</h3>
        <p>Alive - Left: ${unitSummary.left}, Right: ${unitSummary.right}</p>
        <p>Pressure: ${pressure.trend} (delta ${pressure.delta.toFixed(1)})</p>
        <p>Average front - Left x${pressure.leftAvg.toFixed(1)}, Right x${pressure.rightAvg.toFixed(1)}</p>
      </section>
      <section class="status-card">
        <h3>Result</h3>
        <p>Winner: ${state.winner ?? 'in progress'}</p>
      </section>
    </div>

    <section class="status-card">
      <h3>Battlefield (ASCII)</h3>
      <pre class="battlefield-ascii">${battlefieldAscii}</pre>
    </section>

    <section class="status-card">
      <h3>Feedback Log (latest 5)</h3>
      <ul>
        ${feedback.length > 0 ? feedback.map((event) => `<li>${event}</li>`).join('') : '<li>none</li>'}
      </ul>
    </section>

    <section class="status-card">
      <h3>Debug Inspector</h3>
      ${selectedUnit ? `
        <p>Unit: ${selectedUnit.unitId} (${selectedUnit.side} / ${selectedUnit.typeId})</p>
        <p>HP: ${selectedUnit.hp}/${selectedUnit.maxHp}</p>
        <p>Position: x ${selectedUnit.x.toFixed(1)}, y ${selectedUnit.y.toFixed(1)}</p>
        <p>Target: ${selectedUnit.targetId ?? 'none'}${selectedUnit.targetDistance !== null ? ` (d ${selectedUnit.targetDistance.toFixed(2)})` : ''}</p>
        <p>State: ${selectedUnit.actionHint}, blocked ${selectedUnit.blockedByAlly}, blockedTicks ${selectedUnit.blockedTicks}, sidestepCd ${selectedUnit.sidestepCooldown}</p>
      ` : '<p>Select a unit from controls to inspect.</p>'}
    </section>
  `;
}

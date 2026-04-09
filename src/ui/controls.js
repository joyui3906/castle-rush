import { canBuild, canSell, enqueueCommand } from '../core/sim.js';

function dispatchGameCommand(state, simControl, command) {
  if (simControl.isNetworkMode?.()) {
    return simControl.dispatchNetworkCommand?.(command) ?? false;
  }
  return enqueueCommand(state, command);
}

function makeBuildButton({ side, buildingTypeId, cost, enabled }) {
  const disabled = enabled ? '' : 'disabled';
  return `<button data-side="${side}" data-building="${buildingTypeId}" ${disabled}>${side} build ${buildingTypeId} (${cost}g)</button>`;
}

function renderSlotMap(state, data, side) {
  const castle = state.castles[side];
  const selected = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;
  const slots = [...(castle.slots ?? [])];
  const laneLength = data.battleLane.length;
  const roadHalfWidth = data.combat?.movement?.roadHalfWidth ?? 6;

  return `
    <div class="slot-map">
      <div class="slot-map-header">
        <span>y +${roadHalfWidth}</span>
        <span>x 0 .. ${laneLength}</span>
        <span>y -${roadHalfWidth}</span>
      </div>
      <div class="slot-map-canvas">
        <div class="slot-map-center-line"></div>
        <div class="slot-map-castle slot-map-castle-left">L</div>
        <div class="slot-map-castle slot-map-castle-right">R</div>
      ${slots.map((slot) => {
        const occupied = Boolean(slot.buildingTypeId);
        const selectedClass = selected === slot.index ? 'slot-selected' : '';
        const occupiedClass = occupied ? 'slot-occupied' : 'slot-empty';
        const left = (slot.x / laneLength) * 100;
        const top = ((roadHalfWidth - slot.y) / (roadHalfWidth * 2)) * 100;
        const label = occupied
          ? `#${slot.index} x:${slot.x} y:${slot.y} ${slot.buildingTypeId} hp:${Math.max(0, Math.round(slot.buildingHp))}`
          : `#${slot.index} x:${slot.x} y:${slot.y} empty`;
        return `
          <button
            class="slot-cell ${selectedClass} ${occupiedClass}"
            data-action="select-slot"
            data-side="${side}"
            data-slot-index="${slot.index}"
            title="${label}"
            style="left:${left}%; top:${top}%;"
          >
            <span class="slot-cell-index">${slot.index}</span>
          </button>
        `;
      }).join('')}
      </div>
      <div class="slot-map-footer">
        <span>Legend:</span>
        <span class="legend-chip legend-selected">selected</span>
        <span class="legend-chip legend-occupied">occupied</span>
        <span class="legend-chip legend-empty">empty</span>
      </div>
    </div>
  `;
}

function renderControlsHtml(state, data, simControl) {
  const isNetworkMode = simControl.isNetworkMode?.() ?? false;
  const networkInfo = simControl.getNetworkInfo?.() ?? null;
  const buildOptions = Object.keys(data.buildingTypes);
  const rows = ['left', 'right'].map((side) => {
    const selectedSlotIndex = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;
    const canSellSelected = canSell(state, side, selectedSlotIndex);
    const buttons = buildOptions.map((buildingTypeId) => {
      const cost = data.buildingTypes[buildingTypeId].cost;
      const enabled = canBuild(state, data, side, buildingTypeId, selectedSlotIndex) && (!isNetworkMode || networkInfo?.side === side);
      return makeBuildButton({ side, buildingTypeId, cost, enabled });
    }).join('');

    return `
      <div class="controls-row">
        <strong>${side.toUpperCase()}</strong>
        ${renderSlotMap(state, data, side)}
        <button data-action="sell-slot" data-side="${side}" ${(canSellSelected && (!isNetworkMode || networkInfo?.side === side)) ? '' : 'disabled'}>${side} sell selected</button>
        ${buttons}
      </div>
    `;
  });

  const isPaused = simControl.getPaused();
  const speed = simControl.getSpeed();
  const comebackEnabled = Boolean(data.combat?.comebackSpawn?.enabled);
  const defenseEnabled = data.combat?.castleDefenseBonus?.enabled !== false;
  const unitOptions = state.battleLane.unitIds
    .filter((unitId) => state.units[unitId]?.hp > 0)
    .map((unitId) => `<option value="${unitId}" ${state.debug.selectedUnitId === unitId ? 'selected' : ''}>${unitId}</option>`)
    .join('');
  const networkSection = isNetworkMode ? `
    <h2>Match Network</h2>
    <div class="controls-row">
      <label>Server URL
        <input data-control="network-server-url" value="${networkInfo?.serverUrl ?? ''}" />
      </label>
      <label>Match ID
        <input data-control="network-match-id" value="${networkInfo?.matchId ?? ''}" />
      </label>
      <label>Player ID
        <input data-control="network-player-id" value="${networkInfo?.playerId ?? ''}" />
      </label>
    </div>
    <div class="controls-row">
      <button data-action="network-connect" ${networkInfo?.connected || networkInfo?.connecting ? 'disabled' : ''}>Connect</button>
      <button data-action="network-disconnect" ${networkInfo?.connected ? '' : 'disabled'}>Disconnect</button>
      <button data-action="network-toggle-ready" ${networkInfo?.connected ? '' : 'disabled'}>${networkInfo?.ready ? 'Unready' : 'Ready'}</button>
      <button data-action="network-snapshot" ${networkInfo?.connected ? '' : 'disabled'}>Snapshot</button>
      <span>status: ${networkInfo?.connected ? `connected (${networkInfo?.side ?? 'spectator'})` : networkInfo?.connecting ? 'connecting' : 'offline'}</span>
      ${networkInfo?.lastError ? `<span>error: ${networkInfo.lastError}</span>` : ''}
    </div>
    <div class="controls-row">
      <span>matchStatus: ${networkInfo?.matchStatus ?? 'unknown'}</span>
      <span>serverTick: ${networkInfo?.lastServerTick ?? 0}</span>
      <span>stateTick: ${networkInfo?.lastStateTick ?? 0}</span>
      <span>rtt: ${networkInfo?.rttMs !== null && networkInfo?.rttMs !== undefined ? `${networkInfo.rttMs}ms` : '-'}</span>
      <span>pendingCmd: ${networkInfo?.pendingCommandCount ?? 0}</span>
      <span>lastSnapshot: ${networkInfo?.lastSnapshotAtMs ? `${Math.max(0, Math.floor((Date.now() - networkInfo.lastSnapshotAtMs) / 1000))}s ago` : '-'}</span>
    </div>
  ` : '';

  return `
    ${networkSection}
    <h2>Build Controls</h2>
    <p>Sell refund ratio: ${(data.goldIncome?.sellRefundRatio ?? 0.6) * 100}%</p>
    ${rows.join('')}

    <h2>Simulation</h2>
    <div class="controls-row">
      <button data-action="toggle-pause">${isPaused ? 'Resume' : 'Pause'}</button>
      <button data-action="step">Step +1 tick</button>
      <label>Speed
        <select data-control="speed">
          <option value="1" ${speed === 1 ? 'selected' : ''}>1x</option>
          <option value="2" ${speed === 2 ? 'selected' : ''}>2x</option>
          <option value="4" ${speed === 4 ? 'selected' : ''}>4x</option>
        </select>
      </label>
    </div>

    <h2>Balance Toggles</h2>
    <div class="controls-row">
      <label><input type="checkbox" data-control="comeback" ${comebackEnabled ? 'checked' : ''} /> Comeback spawn</label>
      <label><input type="checkbox" data-control="defense" ${defenseEnabled ? 'checked' : ''} /> Castle defense bonus</label>
    </div>

    <h2>Debug Inspector</h2>
    <div class="controls-row">
      <label>Unit
        <select data-control="inspect-unit">
          <option value="">(none)</option>
          ${unitOptions}
        </select>
      </label>
    </div>
  `;
}

export function setupControls(root, state, data, rerender, simControl) {
  if (!root) return;

  const onClick = (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const target = rawTarget.closest('button');
    if (!(target instanceof HTMLButtonElement)) return;

    const action = target.dataset.action;
    if (action === 'toggle-pause') {
      simControl.setPaused(!simControl.getPaused());
      rerender();
      return;
    }

    if (action === 'step') {
      simControl.stepOnce();
      return;
    }

    if (action === 'network-connect') {
      simControl.connectNetwork?.();
      rerender();
      return;
    }

    if (action === 'network-disconnect') {
      simControl.disconnectNetwork?.();
      rerender();
      return;
    }

    if (action === 'network-toggle-ready') {
      simControl.toggleNetworkReady?.();
      rerender();
      return;
    }

    if (action === 'network-snapshot') {
      simControl.requestNetworkSnapshot?.();
      return;
    }

    const side = target.dataset.side;
    if (action === 'select-slot') {
      if (!side) return;
      const slotIndex = Number(target.dataset.slotIndex);
      if (!Number.isNaN(slotIndex) && state.ui?.selectedBuildSlotBySide) {
        state.ui.selectedBuildSlotBySide[side] = slotIndex;
      }
      rerender();
      return;
    }

    if (!side) return;

    if (action === 'sell-slot') {
      const selectedSlotIndex = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;
      const enqueued = dispatchGameCommand(state, simControl, {
        type: 'sell',
        payload: { side, slotIndex: selectedSlotIndex },
      });
      if (enqueued) rerender();
      return;
    }

    const buildingTypeId = target.dataset.building;
    if (!buildingTypeId) return;
    const selectedSlotIndex = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;

    const enqueued = dispatchGameCommand(state, simControl, {
      type: 'build',
      payload: { side, buildingTypeId, slotIndex: selectedSlotIndex },
    });
    if (enqueued) rerender();
  };

  const onChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const control = target.dataset.control;
    if (!control) return;

    if (control === 'speed' && target instanceof HTMLSelectElement) {
      const nextSpeed = Number(target.value);
      if (nextSpeed > 0) simControl.setSpeed(nextSpeed);
      rerender();
      return;
    }

    if (control === 'comeback' && target instanceof HTMLInputElement) {
      dispatchGameCommand(state, simControl, {
        type: 'toggle_rule',
        payload: { rule: 'comeback_spawn', enabled: target.checked },
      });
      rerender();
      return;
    }

    if (control === 'defense' && target instanceof HTMLInputElement) {
      dispatchGameCommand(state, simControl, {
        type: 'toggle_rule',
        payload: { rule: 'castle_defense_bonus', enabled: target.checked },
      });
      rerender();
      return;
    }

    if (control === 'inspect-unit' && target instanceof HTMLSelectElement) {
      state.debug.selectedUnitId = target.value || null;
      rerender();
      return;
    }

    if (control === 'network-server-url' && target instanceof HTMLInputElement) {
      simControl.updateNetworkConfig?.({ serverUrl: target.value });
      return;
    }

    if (control === 'network-match-id' && target instanceof HTMLInputElement) {
      simControl.updateNetworkConfig?.({ matchId: target.value });
      return;
    }

    if (control === 'network-player-id' && target instanceof HTMLInputElement) {
      simControl.updateNetworkConfig?.({ playerId: target.value });
      return;
    }

  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  return () => {
    root.innerHTML = renderControlsHtml(state, data, simControl);
  };
}

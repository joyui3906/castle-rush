import { canBuild, canSell, enqueueCommand } from '../core/sim.js';
import {
  NETWORK_COMMAND_TEXT,
  NETWORK_PLAYER_TEXT,
  NETWORK_PHASE,
} from '../net/network-messages.js';

function formatPlayerTag(side, player, isLocalSide) {
  if (!player) {
    return `${side}: waiting`;
  }
  const ready = player.ready ? NETWORK_PLAYER_TEXT.READY : NETWORK_PLAYER_TEXT.NOT_READY;
  const connected = player.connected ? NETWORK_PLAYER_TEXT.ONLINE : NETWORK_PLAYER_TEXT.OFFLINE;
  return `${side}: ${player.playerId || NETWORK_PLAYER_TEXT.UNKNOWN_PLAYER} (${ready}, ${connected})${isLocalSide ? ` ${NETWORK_PLAYER_TEXT.YOU_TAG}` : ''}`;
}

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
  const matchPhase = networkInfo?.matchPhase ?? networkInfo?.matchStatus ?? NETWORK_PHASE.OFFLINE;
  const matchCanBuild = matchPhase === NETWORK_PHASE.RUNNING;
  const canToggleReady = Boolean(networkInfo?.connected)
    && Boolean(networkInfo?.side)
    && matchPhase !== NETWORK_PHASE.FULL
    && matchPhase !== NETWORK_PHASE.FINISHED
    && networkInfo?.matchStatus !== NETWORK_PHASE.ERROR;
  const localSide = networkInfo?.side;
  const leftPlayer = networkInfo?.players?.left;
  const rightPlayer = networkInfo?.players?.right;
  const rows = ['left', 'right'].map((side) => {
    const selectedSlotIndex = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;
    const isOwnSide = !isNetworkMode || networkInfo?.side === side;
    const canSellSelected = canSell(state, side, selectedSlotIndex) && (!isNetworkMode || (isOwnSide && matchCanBuild));
    const buttons = buildOptions.map((buildingTypeId) => {
      const cost = data.buildingTypes[buildingTypeId].cost;
      const enabled = canBuild(state, data, side, buildingTypeId, selectedSlotIndex)
        && (!isNetworkMode || (isOwnSide && matchCanBuild));
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
  const reconnectAttempts = networkInfo?.reconnectAttempts ?? 0;
  const reconnectMaxAttempts = networkInfo?.reconnectMaxAttempts ?? 0;
  const reconnectScheduledAtMs = networkInfo?.reconnectScheduledAtMs ?? null;
  const reconnectScheduledDelayMs = networkInfo?.reconnectScheduledDelayMs ?? null;
  const isMatchFull = networkInfo?.matchPhase === NETWORK_PHASE.FULL;
  const reconnectRemainingSec = reconnectScheduledAtMs && reconnectScheduledDelayMs && !isMatchFull
    ? Math.max(0, Math.ceil((reconnectScheduledDelayMs - (Date.now() - reconnectScheduledAtMs)) / 1000))
    : null;
  const reconnectLine = isMatchFull
    ? NETWORK_COMMAND_TEXT.FULL_RECONNECT_PREFIX
    : `${reconnectAttempts}/${reconnectMaxAttempts}`;
  const reconnectCountdown = isMatchFull || !reconnectScheduledAtMs
    ? '-'
    : reconnectRemainingSec > 0
      ? `${reconnectRemainingSec}s`
      : '-';
  const phaseLabel = isMatchFull ? NETWORK_PHASE.FULL : matchPhase;
  const connectionLabel = isMatchFull
    ? NETWORK_PHASE.FULL
    : networkInfo?.connected ? `connected (${networkInfo?.side ?? 'spectator'})` : networkInfo?.connecting ? NETWORK_PHASE.CONNECTING : NETWORK_PHASE.OFFLINE;
  const connectLabel = isMatchFull ? NETWORK_COMMAND_TEXT.RETRY_LABEL : NETWORK_COMMAND_TEXT.CONNECT_LABEL;
  const hideErrorLine = isMatchFull;
  const sessionTokenHint = networkInfo?.connectionHint
    ? `<div class="controls-row">hint: ${networkInfo.connectionHint}</div>`
    : '';
  const networkSection = isNetworkMode ? `
    <h2>Match Network</h2>
    ${networkInfo?.reconnectBanner ? `<div class="controls-row"><strong style="color:#d9534f;">${networkInfo.reconnectBanner}</strong></div>` : ''}
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
      <label>Match Auth Token
        <input data-control="network-auth-token" value="${networkInfo?.authToken ?? ''}" type="password" autocomplete="off" />
      </label>
      <label>Session Token
        <input data-control="network-session-token" value="${networkInfo?.sessionToken ?? ''}" autocomplete="off" />
      </label>
    </div>
    <div class="controls-row">
      <button data-action="network-connect" ${networkInfo?.connected || networkInfo?.connecting || !networkInfo?.serverUrl || !networkInfo?.matchId || !networkInfo?.playerId ? 'disabled' : ''}>${connectLabel}</button>
      <button data-action="network-disconnect" ${networkInfo?.connected ? '' : 'disabled'}>${NETWORK_COMMAND_TEXT.DISCONNECT_LABEL}</button>
      <button data-action="network-toggle-ready" ${isMatchFull || !canToggleReady ? 'disabled' : ''}>${networkInfo?.ready ? NETWORK_COMMAND_TEXT.UNREADY_LABEL : NETWORK_COMMAND_TEXT.READY_LABEL}</button>
      <button data-action="network-snapshot" ${isMatchFull || !networkInfo?.connected || !networkInfo?.side ? 'disabled' : ''}>${NETWORK_COMMAND_TEXT.SNAPSHOT_LABEL}</button>
      <label><input type="checkbox" data-control="network-auto-ready" ${networkInfo?.autoReady ? 'checked' : ''} /> Auto ready</label>
      <span>connection: ${connectionLabel}</span>
      <span>phase: ${phaseLabel}</span>
      ${hideErrorLine ? '' : networkInfo?.lastError ? `<span>error: ${networkInfo.lastError}</span>` : ''}
    </div>
    <div class="controls-row">
      <span>${formatPlayerTag('Left', leftPlayer, localSide === 'left')}</span>
      <span>${formatPlayerTag('Right', rightPlayer, localSide === 'right')}</span>
    </div>
    <div class="controls-row">
      <span>serverTick: ${networkInfo?.lastServerTick ?? 0}</span>
      <span>stateTick: ${networkInfo?.lastStateTick ?? 0}</span>
      <span>rtt: ${networkInfo?.rttMs !== null && networkInfo?.rttMs !== undefined ? `${networkInfo.rttMs}ms` : '-'}</span>
      <span>pendingCmd: ${networkInfo?.pendingCommandCount ?? 0}</span>
      <span>lastSnapshot: ${networkInfo?.lastSnapshotAtMs ? `${Math.max(0, Math.floor((Date.now() - networkInfo.lastSnapshotAtMs) / 1000))}s ago` : '-'}</span>
      <span>reconnect: ${reconnectLine}</span>
      <span>nextRetry: ${networkInfo?.reconnectScheduledAtMs ? reconnectCountdown : '-'}</span>
    </div>
    ${sessionTokenHint}
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

    if (control === 'network-auth-token' && target instanceof HTMLInputElement) {
      simControl.updateNetworkConfig?.({ authToken: target.value });
      return;
    }

    if (control === 'network-session-token' && target instanceof HTMLInputElement) {
      simControl.updateNetworkConfig?.({ sessionToken: target.value || null });
      return;
    }

    if (control === 'network-auto-ready' && target instanceof HTMLInputElement) {
      simControl.updateNetworkConfig?.({ autoReady: target.checked });
      return;
    }

  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  return () => {
    root.innerHTML = renderControlsHtml(state, data, simControl);
  };
}

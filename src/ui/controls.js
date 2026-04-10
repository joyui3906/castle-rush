import { canBuild, canSell, canUseNuke, enqueueCommand } from '../core/sim.js';
import {
  NETWORK_COMMAND_TEXT,
  NETWORK_PLAYER_TEXT,
  NETWORK_PHASE,
} from '../net/network-messages.js';

function applyNukeOptimisticPreview(state, side) {
  if (!state?.ui || !state?.battleLane?.unitIds) return;

  const opponent = side === 'left' ? 'right' : 'left';
  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units?.[unitId];
    if (!unit || unit.side !== opponent || unit.hp <= 0) continue;
    unit.hp = 0;
  }

  if (!state.ui.nukeUsed) {
    state.ui.nukeUsed = { left: false, right: false };
  }
  state.ui.nukeUsed[side] = true;
  state.ui.nukeEffect = {
    side,
    startedAtTick: state.tick,
    durationTicks: 3,
  };
}

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

function makeBuildButton({
  side,
  buildingTypeId,
  cost,
  enabled,
  existingCount,
  totalSlots,
  affordable,
}) {
  const disabled = enabled ? '' : 'disabled';
  const affordableClass = affordable ? '' : 'build-btn-need-gold';
  const label = formatBuildingLabel(buildingTypeId);
  return `
    <button class="build-btn ${affordableClass}" data-side="${side}" data-building="${buildingTypeId}" ${disabled}>
      <span class="build-btn-name">${label}</span>
      <span class="build-btn-meta">
        <span class="build-btn-meta-item">#${existingCount}/${totalSlots}</span>
        <span class="build-btn-cost">${cost}g</span>
      </span>
    </button>
  `;
}

function getCastleBuildStats(castle, buildingTypeIds) {
  const slots = [...(castle?.slots ?? [])];
  const total = slots.length;
  const used = slots.filter((slot) => slot.buildingTypeId && slot.buildingHp > 0).length;
  const perType = Object.fromEntries((buildingTypeIds ?? []).map((buildingTypeId) => [buildingTypeId, 0]));
  for (const slot of slots) {
    if (!slot.buildingTypeId || slot.buildingHp <= 0) continue;
    if (perType[slot.buildingTypeId] !== undefined) {
      perType[slot.buildingTypeId] += 1;
    }
  }

  return {
    total,
    used,
    free: Math.max(0, total - used),
    perType,
  };
}

function formatBuildingLabel(buildingTypeId) {
  const labels = {
    income_mine: 'Mine',
    barracks: 'Barracks',
    range_tower: 'Range',
    tank_forge: 'Forge',
    splash_tower: 'Splash',
  };

  return labels[buildingTypeId] ?? buildingTypeId;
}

function renderSlotMap(state, data, side) {
  const castle = state.castles[side];
  const selected = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;
  const slots = [...(castle.slots ?? [])];
  const occupiedSlots = slots
    .filter((slot) => Boolean(slot.buildingTypeId))
    .map((slot) => ({
      index: slot.index,
      type: formatBuildingLabel(slot.buildingTypeId),
      hp: Math.max(0, Math.round(slot.buildingHp ?? 0)),
    }));
  const directionArrow = side === 'left' ? '➡' : '⬅';
  const directionText = side === 'left' ? 'L → R' : 'R → L';

  const byY = new Map();
  const laneLength = data.battleLane.length;
  const forwardX = (slot) => (side === 'left' ? slot.x : laneLength - slot.x);
  for (const slot of slots) {
    const key = slot.y;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(slot);
  }
  const yValues = [...byY.keys()].sort((a, b) => b - a);
  const sortedYRows = yValues.map((y) => {
    const group = byY.get(y)?.slice() ?? [];
    const ordered = group.sort((a, b) => forwardX(b) - forwardX(a));
    return {
      y,
      front: ordered[0] ?? null,
      back: ordered[1] ?? null,
    };
  });

  return `
    <div class="slot-control">
      <div class="slot-control-header">
        <strong>공격 방향</strong>
        <span class="slot-direction-wrap ${side === 'left' ? 'slot-direction-left' : 'slot-direction-right'}" aria-hidden="true">
          <span class="slot-direction">${directionArrow}</span>
          <span class="slot-direction-text">${directionText}</span>
        </span>
      </div>
      <div class="slot-grid">
        ${sortedYRows.map((row) => {
          const rowLabel = row.y >= 0 ? `+${row.y}` : `${row.y}`;
          return `
              <div class="slot-grid-row">
                <span class="slot-row-label">y ${rowLabel}</span>
                <div class="slot-grid-pair">
                  ${side === 'left'
                    ? `${renderSlotCell(row.back, rowLabel, side, selected, 'back')}${renderSlotCell(row.front, rowLabel, side, selected, 'front')}`
                    : `${renderSlotCell(row.front, rowLabel, side, selected, 'front')}${renderSlotCell(row.back, rowLabel, side, selected, 'back')}`}
                </div>
              </div>
            `;
        }).join('')}
      </div>
      <div class="slot-summary">
        ${occupiedSlots.length === 0
          ? '<span class="slot-summary-empty">No buildings placed yet.</span>'
          : occupiedSlots
            .map(
              (slot) => `<span class="slot-summary-chip">${slot.type} @ #${slot.index} (${slot.hp}HP)</span>`,
            )
            .join('')}
      </div>
    </div>
  `;
}

function renderSlotCell(slot, rowLabel, side, selectedSlotIndex, offsetLabel) {
  if (!slot) {
    return `<div class="slot-chip slot-chip-empty slot-grid-empty">${offsetLabel} · -</div>`;
  }

  const occupied = Boolean(slot.buildingTypeId);
  const selectedClass = selectedSlotIndex === slot.index ? 'slot-chip-selected' : '';
  const occupiedClass = occupied ? 'slot-chip-occupied' : 'slot-chip-empty';
  const sideLabel = side === 'left' ? 'L' : 'R';
  const label = occupied
    ? `#${slot.index} ${sideLabel}:${offsetLabel} y${rowLabel} ${slot.buildingTypeId} hp:${Math.max(0, Math.round(slot.buildingHp ?? 0))}`
    : `#${slot.index} ${sideLabel}:${offsetLabel} y${rowLabel} empty`;

  return `
    <button
      class="slot-chip ${selectedClass} ${occupiedClass}"
      data-action="select-slot"
      data-side="${side}"
      data-slot-index="${slot.index}"
      title="${label}"
    >
      <span class="slot-chip-index">${offsetLabel}</span>
      <span class="slot-chip-name">${occupied ? formatBuildingLabel(slot.buildingTypeId) : 'empty'}</span>
    </button>
  `;
}

function renderControlsHtml(state, data, simControl) {
  const isNetworkMode = simControl.isNetworkMode?.() ?? false;
  const isLocalMode = !isNetworkMode;
  const networkInfo = simControl.getNetworkInfo?.() ?? null;
  const isMatchStarted = simControl.isMatchStarted?.() ?? true;
  const singleMode = !isNetworkMode && Boolean(simControl.getSingleModeConfig?.()?.enabled);
  const singleModeConfig = simControl.getSingleModeConfig?.() ?? {};
  const singleModeHumanSide = isLocalMode ? (singleModeConfig.humanSide === 'right' ? 'right' : 'left') : null;
  const singleModeProfile = ['econ', 'aggressive'].includes(singleModeConfig.aiProfile)
    ? singleModeConfig.aiProfile
    : 'balanced';
  const buildOptions = Object.keys(data.buildingTypes);
  const matchPhase = networkInfo?.matchPhase ?? networkInfo?.matchStatus ?? NETWORK_PHASE.OFFLINE;
  const matchCanBuild = matchPhase === NETWORK_PHASE.RUNNING;
  const showRestartMatch = !isNetworkMode && Boolean(state.winner);
  const localMatchFinished = !isNetworkMode && Boolean(state.winner);
  const disableLocalBuildActions = localMatchFinished;
  const canToggleReady = Boolean(networkInfo?.connected)
    && Boolean(networkInfo?.side)
    && matchPhase !== NETWORK_PHASE.FULL
    && matchPhase !== NETWORK_PHASE.FINISHED
    && networkInfo?.matchStatus !== NETWORK_PHASE.ERROR;
  const localSide = networkInfo?.side;
  const leftPlayer = networkInfo?.players?.left;
  const rightPlayer = networkInfo?.players?.right;
  const visibleControlSides = isNetworkMode
    ? networkInfo?.side === 'left' || networkInfo?.side === 'right'
      ? [networkInfo.side]
      : []
    : singleMode
      ? [singleModeHumanSide || 'left']
      : ['left', 'right'];
  const controlsHeader = isNetworkMode && visibleControlSides.length === 1
    ? `Build Controls (${visibleControlSides[0].toUpperCase()})`
    : singleMode
      ? `Build Controls (${(singleModeHumanSide || 'left').toUpperCase()})`
      : 'Build Controls';
  const rows = visibleControlSides.map((side) => {
    const selectedSlotIndex = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;
    const sideCastle = state.castles[side] ?? {};
    const sideGold = sideCastle.gold ?? 0;
    const buildStats = getCastleBuildStats(sideCastle, buildOptions);
    const canInteractWithSide = !singleMode || side === singleModeHumanSide;
    const isOwnSide = !isNetworkMode || networkInfo?.side === side;
    const canSellSelected = canSell(state, side, selectedSlotIndex)
      && (!isNetworkMode || (isOwnSide && matchCanBuild))
      && canInteractWithSide
      && !disableLocalBuildActions;
    const canUseNukeNow = canUseNuke(state, side)
      && !disableLocalBuildActions
      && !localMatchFinished
      && canInteractWithSide
      && (!isNetworkMode || (isOwnSide && matchCanBuild));
    const buttons = buildOptions.map((buildingTypeId) => {
      const cost = data.buildingTypes[buildingTypeId].cost;
      const existingCount = buildStats.perType?.[buildingTypeId] ?? 0;
      const enabled = canBuild(state, data, side, buildingTypeId, selectedSlotIndex)
        && (!isNetworkMode || (isOwnSide && matchCanBuild))
        && canInteractWithSide;
      return makeBuildButton({
        side,
        buildingTypeId,
        cost,
        enabled: enabled && !disableLocalBuildActions,
        existingCount,
        totalSlots: buildStats.total,
        affordable: sideGold >= cost,
      });
    }).join('');

    return `
      <div class="controls-row">
        <strong>${side.toUpperCase()}</strong>
        ${renderSlotMap(state, data, side)}
        <div class="build-actions-row">
          <span class="build-actions-meta">slots ${buildStats.used}/${buildStats.total} • gold ${sideGold}g</span>
          <button
            class="build-btn build-btn-sell"
            data-action="sell-slot"
            data-side="${side}"
            ${(canSellSelected && (!isNetworkMode || networkInfo?.side === side)) ? '' : 'disabled'}
          >
            <span class="build-btn-name">선택 슬롯</span>
            <span class="build-btn-cost">해체</span>
          </button>
          <span class="build-actions-label">건설:</span>
          ${buttons}
          <button
            class="build-btn build-btn-nuke ${state.ui?.nukeUsed?.[side] ? 'build-btn-nuke-used' : ''}"
            data-action="nuke"
            data-side="${side}"
            ${canUseNukeNow ? '' : 'disabled'}
          >
            <span class="build-btn-name">폭격</span>
            <span class="build-btn-cost">${state.ui?.nukeUsed?.[side] ? '사용 완료' : '적 유닛 제거'}</span>
          </button>
        </div>
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
  const showLandingScreen = isLocalMode && !isMatchStarted;
  const launchSection = showLandingScreen ? `
    <div class="match-launch">
      <h2>Match Start</h2>
      <p>게임이 멈춘 상태로 시작합니다. 로컬로 진행하려면 아래에서 모드를 선택하세요.</p>
      <div class="controls-row">
        <button data-action="start-match" data-mode="local">Start 1v1 (both)</button>
        <button data-action="start-match" data-mode="single">Start Single (vs AI)</button>
      </div>
      <div class="controls-row">
        <label>AI Human Side
          <select data-control="single-human-side">
            <option value="left" ${singleModeHumanSide === 'left' ? 'selected' : ''}>Left</option>
            <option value="right" ${singleModeHumanSide === 'right' ? 'selected' : ''}>Right</option>
          </select>
        </label>
        <label>AI Profile
          <select data-control="single-ai-profile">
            <option value="balanced" ${singleModeProfile === 'balanced' ? 'selected' : ''}>Balanced</option>
            <option value="econ" ${singleModeProfile === 'econ' ? 'selected' : ''}>Econ</option>
            <option value="aggressive" ${singleModeProfile === 'aggressive' ? 'selected' : ''}>Aggressive</option>
          </select>
        </label>
      </div>
      <p>URL single 옵션: <code>/?single&humanSide=left|right&aiProfile=balanced|econ|aggressive</code></p>
    </div>
  ` : '';

  if (showLandingScreen) {
    return `
      ${launchSection}
    `;
  }

  return `
    ${networkSection}
    ${singleMode ? `<p>Single-player mode: you control ${singleModeHumanSide}; AI controls ${singleModeHumanSide === 'left' ? 'right' : 'left'}. Try: /?single&humanSide=${singleModeHumanSide}&aiProfile=balanced</p>` : ''}
    <h2>${controlsHeader}</h2>
    <p>Sell refund ratio: ${(data.goldIncome?.sellRefundRatio ?? 0.6) * 100}%</p>
    ${isNetworkMode && visibleControlSides.length === 0 ? '<p>Waiting for side assignment.</p>' : ''}
    ${rows.join('')}

    <h2>Simulation</h2>
    <div class="controls-row">
      <button data-action="toggle-pause" ${localMatchFinished ? 'disabled' : ''}>${isPaused ? 'Resume' : 'Pause'}</button>
      ${isLocalMode && showRestartMatch ? '<button data-action="restart-match">Restart match</button>' : ''}
      <button data-action="step" ${localMatchFinished ? 'disabled' : ''}>Step +1 tick</button>
      <label>Speed
        <select data-control="speed" ${localMatchFinished ? 'disabled' : ''}>
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
  const isLocalMode = !simControl.isNetworkMode?.();
  const isLocalMatchFinished = () => isLocalMode && Boolean(state.winner);
  const getMatchStarted = () => simControl.isMatchStarted?.() ?? true;
  const getSingleModeStartConfig = () => {
    const getValue = (selector, fallback) => {
      const target = root?.querySelector(`[data-control="${selector}"]`);
      if (target instanceof HTMLSelectElement) return target.value;
      return fallback;
    };
    return {
      humanSide: getValue('single-human-side', 'left') === 'right' ? 'right' : 'left',
      aiProfile: ['econ', 'balanced', 'aggressive'].includes(getValue('single-ai-profile', 'balanced'))
        ? getValue('single-ai-profile', 'balanced')
        : 'balanced',
    };
  };

  const getSingleModeHumanSide = () => {
    if (!state.ui?.singleMode?.enabled) return null;
    return state.ui.singleMode.humanSide || 'left';
  };

  const canInteractWithSide = (side) => {
    const humanSide = getSingleModeHumanSide();
    if (!humanSide) return true;
    return side === humanSide;
  };

  const onKeyDown = (event) => {
    if (!isLocalMode) return;
    if (!state.winner) return;
    if (event.defaultPrevented) return;
    if (!(event.key === 'r' || event.key === 'R')) return;
    if (!event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    event.preventDefault();
    simControl.restartMatch?.();
    rerender();
  };

  const onClick = (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const target = rawTarget.closest('button');
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.action;
    if (action === 'select-slot' || action === 'sell-slot' || action === 'start-match') {
      if (!getMatchStarted() && action !== 'start-match') return;
    }
    if (action === 'select-slot' || action === 'sell-slot' || action === 'restart-match') {
      if (action !== 'restart-match' && isLocalMatchFinished()) return;
    }
    if (action === 'start-match') {
      const isSingleMode = target.dataset.mode === 'single';
      const nextConfig = getSingleModeStartConfig();
      simControl.startMatch?.({
        enabled: isSingleMode,
        humanSide: isSingleMode ? nextConfig.humanSide : 'left',
        aiProfile: isSingleMode ? nextConfig.aiProfile : 'balanced',
      });
      rerender();
      return;
    }
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

    if (action === 'restart-match') {
      simControl.restartMatch?.();
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
      if (!canInteractWithSide(side)) return;
      const slotIndex = Number(target.dataset.slotIndex);
      if (!Number.isNaN(slotIndex) && state.ui?.selectedBuildSlotBySide) {
        state.ui.selectedBuildSlotBySide[side] = slotIndex;
      }
      rerender();
      return;
    }

    if (!side) return;
    if (!canInteractWithSide(side)) return;

    if (isLocalMatchFinished() && isLocalMode && action !== 'restart-match') {
      return;
    }

    if (action === 'sell-slot') {
      const selectedSlotIndex = state.ui?.selectedBuildSlotBySide?.[side] ?? 0;
      const enqueued = dispatchGameCommand(state, simControl, {
        type: 'sell',
        payload: { side, slotIndex: selectedSlotIndex },
      });
      if (enqueued) rerender();
      return;
    }

    if (action === 'nuke') {
      if (isLocalMatchFinished()) return;
      if (!canUseNuke(state, side)) return;
      const enqueued = dispatchGameCommand(state, simControl, { type: 'nuke', payload: { side } });
      if (enqueued) {
        if (simControl.isNetworkMode?.()) {
          applyNukeOptimisticPreview(state, side);
        }
        rerender();
      }
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
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    root.innerHTML = renderControlsHtml(state, data, simControl);
  };
}

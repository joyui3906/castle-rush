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

function renderMatchMetricChip(label, value, tone = '') {
  const chipClass = tone ? `match-metric-chip match-metric-chip-${tone}` : 'match-metric-chip';
  return `<span class="${chipClass}" aria-label="${label} ${value}"><span class="match-metric-label">${label}</span><span class="match-metric-value">${value}</span></span>`;
}

function renderResultChip(label, value, tone = '') {
  const chipClass = tone ? `result-chip result-chip-${tone}` : 'result-chip';
  return `<span class="${chipClass}" aria-label="${label} ${value}"><span class="result-chip-label">${label}</span><span class="result-chip-value">${value}</span></span>`;
}

function renderBattlefieldMetaChips(left, right, unitSummary, pressure) {
  return [
    renderResultChip('Units', `L ${unitSummary.left} / R ${unitSummary.right}`),
    renderResultChip('Buildings', `${(left.slots ?? []).filter((slot) => slot.buildingTypeId).length} / ${(right.slots ?? []).filter((slot) => slot.buildingTypeId).length}`),
    renderResultChip('Pressure', `${pressure.trend} (${pressure.delta.toFixed(1)})`),
  ].join('');
}

function formatAiInfo(state) {
  if (!state?.ui?.singleMode?.enabled) return '';
  const humanSide = state.ui.singleMode.humanSide || 'left';
  const aiSide = state.ui.singleMode.aiSide || (humanSide === 'left' ? 'right' : 'left');
  const profile = state.ui.singleMode.aiProfile || 'balanced';
  const remainingPlan = state.ui.singleMode.aiBuildPlan?.length ?? 0;
  return `Single player: ${humanSide} human, ${aiSide} AI [${profile}] (${remainingPlan} scripted steps left)`;
}

const SPRITE_CACHE = new Map();

const battlefieldColors = {
  background: '#020617',
  lane: '#0f172a',
  left: {
    castle: '#60a5fa',
    unit: '#38bdf8',
    unitOutline: '#7dd3fc',
    building: '#fbbf24',
    selectedBuilding: '#22d3ee',
    empty: '#334155',
  },
  right: {
    castle: '#fb7185',
    unit: '#fb7185',
    unitOutline: '#fda4af',
    building: '#fb923c',
    selectedBuilding: '#22d3ee',
    empty: '#334155',
  },
};

function normalizeSpriteKey(prefix, id) {
  if (!id) return '';
  return `${prefix}:${id}`;
}

function getSpriteSource(data, category, typeId) {
  const visual = data.visuals ?? {};
  if (!visual.sprites) return null;
  return visual.sprites?.[category]?.[typeId]
    ?? visual.sprites?.[category]?.[normalizeSpriteKey(category, typeId)]
    ?? null;
}

function preloadSprite(src) {
  if (!src || typeof src !== 'string') return null;
  const cached = SPRITE_CACHE.get(src);
  if (cached) return cached;

  const img = new Image();
  const entry = { src, image: img, ready: false, failed: false, status: 'loading' };

  img.onload = () => {
    entry.ready = true;
    entry.failed = false;
    entry.status = 'ready';
  };
  img.onerror = () => {
    entry.ready = false;
    entry.failed = true;
    entry.status = 'failed';
  };
  img.src = src;

  SPRITE_CACHE.set(src, entry);
  return entry;
}

function drawSpriteIfAvailable(ctx, src, x, y, width, height) {
  const entry = preloadSprite(src);
  if (!entry || !entry.ready) return false;
  ctx.drawImage(entry.image, x, y, width, height);
  return true;
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

function getBuildingLabel(buildingTypeId) {
  const labels = {
    income_mine: 'Mine',
    barracks: 'Barracks',
    range_tower: 'Range',
    tank_forge: 'Forge',
    splash_tower: 'Splash',
  };
  return labels[buildingTypeId] ?? buildingTypeId;
}

function renderSideUnitRows(state, data, side) {
  const units = state.battleLane.unitIds
    .map((unitId) => state.units[unitId])
    .filter((unit) => unit && unit.side === side && unit.hp > 0);

  if (!units.length) {
    return 'No active units';
  }

  const laneLength = data.battleLane.length;
  const sortedUnits = units
    .map((unit) => ({
      ...unit,
      distanceToEnemy: side === 'left' ? laneLength - unit.position : unit.position,
    }))
    .sort((a, b) => a.distanceToEnemy - b.distanceToEnemy);

  return sortedUnits
    .slice(0, 7)
    .map((unit) => {
      const symbol = getUnitSymbol(unit);
      const position = unit.position.toFixed(1).padStart(6, ' ');
      const hp = `${Math.max(0, Math.round(unit.hp)).toString().padStart(3, ' ')}/${unit.maxHp}`;
      const distance = unit.distanceToEnemy.toFixed(1).padStart(6, ' ');
      return `${symbol} ${unit.id} ${unit.typeId.padEnd(8)} hp ${hp} pos ${position} d ${distance}`;
    })
    .join('\n');
}

function getBuildingMaxHp(data, buildingTypeId) {
  return data.buildingTypes[buildingTypeId]?.maxHp ?? 250;
}

function renderSideBuildingRows(state, data, side) {
  const castle = state.castles[side];
  const buildings = (castle?.slots ?? []).filter((slot) => slot.buildingTypeId && slot.buildingHp > 0);

  if (!buildings.length) {
    return 'No buildings built';
  }

  return buildings
    .map((slot) => {
      const maxHp = getBuildingMaxHp(data, slot.buildingTypeId);
      const hp = Math.max(0, Math.round(slot.buildingHp));
      const hpText = maxHp > 0 ? `${hp}/${maxHp}` : `${hp}`;
      return `#${slot.index} ${getBuildingLabel(slot.buildingTypeId)} hp ${hpText} x:${slot.x} y:${slot.y}`;
    })
    .join('\n');
}

function renderBattlefieldDetailsSection(state, data) {
  return `
    <section class="status-card compact-status">
      <h3>Battlefield Details</h3>
      <div class="battlefield-details-grid">
        <div class="battlefield-side">
          <h4>Left side</h4>
          <div class="chip-label">Units (front to back)</div>
          <pre class="battlefield-list">${renderSideUnitRows(state, data, 'left')}</pre>
          <div class="chip-label">Buildings</div>
          <pre class="battlefield-list">${renderSideBuildingRows(state, data, 'left')}</pre>
        </div>
        <div class="battlefield-side">
          <h4>Right side</h4>
          <div class="chip-label">Units (front to back)</div>
          <pre class="battlefield-list">${renderSideUnitRows(state, data, 'right')}</pre>
          <div class="chip-label">Buildings</div>
          <pre class="battlefield-list">${renderSideBuildingRows(state, data, 'right')}</pre>
        </div>
      </div>
    </section>
  `;
}

function worldToScreenX(x, width, paddingX, laneLength) {
  const safeLaneLength = Math.max(1, laneLength);
  const ratio = Math.max(0, Math.min(1, x / safeLaneLength));
  return paddingX + ratio * (width - paddingX * 2);
}

function worldToScreenY(y, height, paddingY, halfWidth) {
  const clampedY = Math.max(-halfWidth, Math.min(halfWidth, y));
  const ratio = (halfWidth - clampedY) / (halfWidth * 2);
  return paddingY + ratio * (height - paddingY * 2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawHpBar(ctx, x, y, width, ratio, color = '#86efac', background = '#334155') {
  const h = 4;
  ctx.fillStyle = background;
  ctx.fillRect(x, y, width, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * ratio, h);
}

function drawNukeEffect(ctx, state, data, width, height, laneLength, paddingX, paddingY, roadY, roadH) {
  const effect = state?.ui?.nukeEffect;
  if (!effect?.side) return;

  const side = effect.side === 'left' ? 'left' : 'right';
  const duration = Math.max(1, effect.durationTicks ?? 3);
  const rawAge = state.tick - (effect.startedAtTick ?? state.tick);
  const age = Math.max(0, rawAge - 1);
  if (age >= duration) return;

  const t = Math.min(1, age / duration);
  const startX = side === 'left'
    ? worldToScreenX(0, width, paddingX, laneLength)
    : worldToScreenX(laneLength, width, paddingX, laneLength);
  const endX = worldToScreenX(side === 'left' ? laneLength : 0, width, paddingX, laneLength);
  const beamX = startX + (endX - startX) * t;
  const wave = Math.sin(t * Math.PI * 8);
  const fade = 1 - t;
  const y0 = roadY;
  const y1 = roadY + roadH;
  const centerY = (y0 + y1) / 2;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulseAlpha = Math.max(0.1, 0.6 * fade);
  const glowAlpha = 0.7 * fade;
  const coreAlpha = 0.9 * fade;

  const gradient = ctx.createLinearGradient(beamX - 14, 0, beamX + 14, 0);
  gradient.addColorStop(0, `rgba(251, 113, 133, ${0.15 * pulseAlpha})`);
  gradient.addColorStop(0.5, `rgba(254, 226, 226, ${0.35 * glowAlpha})`);
  gradient.addColorStop(1, `rgba(251, 113, 133, ${0.15 * pulseAlpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(beamX - 14, y0, 28, roadH);

  ctx.strokeStyle = `rgba(254, 202, 202, ${coreAlpha})`;
  ctx.lineWidth = Math.max(3, 8 * fade);
  ctx.setLineDash([8, 10]);
  ctx.beginPath();
  ctx.moveTo(beamX + (wave * 3), y0);
  ctx.lineTo(beamX + (wave * 3), y1);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < 10; i += 1) {
    const y = y0 + (roadH / 10) * (i + 1);
    const burst = Math.sin((i + 1) * 0.8 + t * 12) * 0.25;
    const radius = 2 + 4 * fade + Math.abs(burst) * 3;
    ctx.fillStyle = `rgba(254, 226, 226, ${0.55 * fade * (1 - (i / 12))})`;
    ctx.beginPath();
    ctx.arc(beamX + burst * 10, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const headRadius = 12 + Math.max(0, 6 * (1 - t));
  const headX = beamX;
  const headY = centerY + Math.sin(state.tick * 0.5 + side.length) * 8;
  const headGradient = ctx.createRadialGradient(headX, headY, 0, headX, headY, headRadius);
  headGradient.addColorStop(0, `rgba(254, 226, 226, ${0.5 * fade})`);
  headGradient.addColorStop(1, `rgba(251, 113, 133, 0)`);
  ctx.fillStyle = headGradient;
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();

  if (t < 0.95) {
    ctx.fillStyle = `rgba(254, 226, 226, ${Math.max(0.2, 0.7 * fade)})`;
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${side.toUpperCase()} NUKE`, width / 2, 20);
  }

  ctx.restore();
}

function drawBattlefieldCanvas(canvas, state, data) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const container = canvas.parentElement;
  const containerWidth = Math.max(320, Math.round(container?.clientWidth || canvas.clientWidth || 980));
  const width = containerWidth;
  const height = Math.max(220, Math.round(width * 0.37));

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const laneLength = data.battleLane.length;
  const movement = data.combat?.movement ?? {};
  const roadHalfWidth = movement.roadHalfWidth ?? 6;
  const paddingX = 30;
  const paddingY = 26;

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#0b1220');
  bg.addColorStop(0.5, '#020617');
  bg.addColorStop(1, '#0b1220');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const roadY = paddingY + 20;
  const roadH = height - paddingY * 2 - 40;
  const roadLeft = paddingX;
  const roadRight = width - paddingX;

  ctx.fillStyle = battlefieldColors.lane;
  ctx.fillRect(roadLeft, roadY, roadRight - roadLeft, roadH);

  // lane boundaries
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1;
  for (const y of [roadY, roadY + roadH / 2, roadY + roadH]) {
    ctx.beginPath();
    ctx.moveTo(roadLeft, y);
    ctx.lineTo(roadRight, y);
    ctx.stroke();
  }

  // center lane marker
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.4;
  const centerY = worldToScreenY(0, height, paddingY, roadHalfWidth);
  ctx.beginPath();
  ctx.moveTo(roadLeft, centerY);
  ctx.lineTo(roadRight, centerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // castles
  for (const side of ['left', 'right']) {
    const x = side === 'left' ? 0 : laneLength;
    const cx = worldToScreenX(x, width, paddingX, laneLength);
    const cy = worldToScreenY(0, height, paddingY, roadHalfWidth);
    const theme = battlefieldColors[side];

    ctx.fillStyle = theme.castle;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(side === 'left' ? 'L' : 'R', cx, cy + 4);
  }

  const selectedSlotBySide = state.ui?.selectedBuildSlotBySide ?? {};

  // slots and buildings
  for (const side of ['left', 'right']) {
    const castle = state.castles[side];
    const theme = battlefieldColors[side];
    const selectedSlotIndex = selectedSlotBySide[side];

    for (const slot of castle.slots ?? []) {
      const sx = worldToScreenX(slot.x, width, paddingX, laneLength);
      const sy = worldToScreenY(slot.y, height, paddingY, roadHalfWidth);
      const hasBuilding = Boolean(slot.buildingTypeId);
      const isSelected = selectedSlotIndex === slot.index;

      if (hasBuilding) {
        const buildingColor = isSelected ? theme.selectedBuilding : theme.building;
        const hpMax = getBuildingMaxHp(data, slot.buildingTypeId);
        const spriteSrc = getSpriteSource(data, 'buildings', slot.buildingTypeId);
        const w = 18;
        const h = 14;

        ctx.fillStyle = buildingColor;
        ctx.strokeStyle = isSelected ? '#e2e8f0' : '#1f2937';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.fillRect(sx - w / 2, sy - h / 2, w, h);
        ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);

        if (spriteSrc) {
          drawSpriteIfAvailable(ctx, spriteSrc, sx - 7, sy - 7, 14, 14);
        } else {
          ctx.fillStyle = '#f8fafc';
          ctx.font = '8px Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(getBuildingLabel(slot.buildingTypeId).slice(0, 2), sx, sy + 3);
        }

        if (slot.buildingHp > 0 && hpMax > 0) {
          const ratio = clamp(slot.buildingHp / hpMax, 0, 1);
          drawHpBar(ctx, sx - 12, sy - 16, 24, ratio, '#fde68a');
        }
      } else {
        ctx.fillStyle = isSelected ? '#22d3ee' : theme.empty;
        ctx.strokeStyle = isSelected ? '#e2e8f0' : '#1f2937';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.beginPath();
        ctx.arc(sx, sy, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '8px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`#${slot.index}`, sx, sy + 3);
      }
    }
  }

  // units
  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units[unitId];
    if (!unit || unit.hp <= 0) continue;

    const ux = worldToScreenX(unit.position, width, paddingX, laneLength);
    const uy = worldToScreenY(unit.y, height, paddingY, roadHalfWidth);
    const theme = battlefieldColors[unit.side];
    const hpRatio = clamp((unit.hp || 0) / Math.max(1, unit.maxHp), 0, 1);
    const spriteSrc = getSpriteSource(data, 'units', unit.typeId);
    const radius = 8;

    let drawn = false;
    if (spriteSrc) {
      drawn = drawSpriteIfAvailable(ctx, spriteSrc, ux - 9, uy - 9, 18, 18);
    }

    if (!drawn) {
      ctx.fillStyle = theme.unit;
      ctx.beginPath();
      ctx.arc(ux, uy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.unitOutline;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '9px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(getUnitSymbol(unit), ux, uy + 3);
    }

    drawHpBar(ctx, ux - 12, uy + 11, 24, hpRatio);
  }

  drawNukeEffect(ctx, state, data, width, height, laneLength, paddingX, paddingY, roadY, roadH);

  // axis labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'center';
  const marks = [0, 25, 50, 75, 100];
  for (const mark of marks) {
    const mx = worldToScreenX((mark / 100) * laneLength, width, paddingX, laneLength);
    const my = worldToScreenY(-roadHalfWidth, height, paddingY, roadHalfWidth) + 18;
    ctx.fillText(`${mark}`, mx, my);
  }
  ctx.fillText('x axis', width / 2, height - 8);
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

  const formatNetworkPhase = (phase) => {
    switch (phase) {
      case 'waiting':
      case 'running':
      case 'finished':
      case 'full':
      case 'error':
      case 'offline':
      case 'connecting':
      case 'connected':
        return phase;
      default:
        return 'unknown';
    }
  };

  const { left, right } = state.castles;
  const unitSummary = summarizeUnitsBySide(state);
  const pressure = calculatePressure(state, data);
  const isFinished = Boolean(state.winner);
  const isNetworkMode = Boolean(state.ui?.network?.enabled);
  const isSingleMode = !isNetworkMode && Boolean(state.ui?.singleMode?.enabled);
  const singleModeHumanSide = isSingleMode ? (state.ui.singleMode.humanSide || 'left') : '';
  const singleModeAiSide = isSingleMode ? (state.ui.singleMode.aiSide || (singleModeHumanSide === 'left' ? 'right' : 'left')) : '';
  const networkMatchPhase = formatNetworkPhase(state.ui?.network?.matchPhase ?? state.ui?.network?.matchStatus);
  const winnerText = state.winner === 'left'
    ? `${left.name}(left)`
    : state.winner === 'right'
      ? `${right.name}(right)`
      : state.winner === 'draw'
        ? 'Draw'
        : '-';
  const resultText = isFinished
    ? `Match finished: winner ${winnerText}`
    : 'In progress';
  const uiAiSummary = formatAiInfo(state);
  const resultTone = !isFinished
    ? 'running'
    : state.winner === 'left'
      ? 'left'
      : state.winner === 'right'
        ? 'right'
        : state.winner === 'draw'
          ? 'draw'
          : 'neutral';
  const networkTone = networkMatchPhase === 'finished' ? 'success' : networkMatchPhase === 'error' ? 'error' : 'neutral';
  const latestEvent = state?.events?.[0] ?? 'No events yet.';

  root.innerHTML = `
    <h2>Single-Lane Battle Simulator</h2>
    <section class="status-card">
      <h3>Battlefield</h3>
      <div class="chip-row">${renderBattlefieldMetaChips(left, right, unitSummary, pressure)}</div>
      <div class="battlefield-canvas-wrap">
        <canvas class="battlefield-canvas" data-battlefield-canvas></canvas>
      </div>
      <div class="chip-label">Legend</div>
      <div class="chip-row">
        ${renderResultChip('Castles', 'L/R', 'secondary')}
        ${renderResultChip('Units', 'Blue: left / Pink: right', 'secondary')}
        ${renderResultChip('Buildings', 'Gold/orange tones', 'secondary')}
        ${renderResultChip('Selected', 'Cyan', 'secondary')}
      </div>
    </section>

    <section class="status-card compact-status">
      <h3>Match Snapshot</h3>
      <p>${isSingleMode ? `Single-player: ${singleModeHumanSide} controlled, ${singleModeAiSide} AI` : 'Local dual-control'}</p>
      ${isSingleMode ? `<p class="muted">${uiAiSummary}</p>` : ''}
      <div class="chip-label">Match</div>
      <div class="chip-row">
        ${renderMatchMetricChip('Time', `${Math.floor(state.timeMs / 1000)}s (tick ${state.tick})`, 'accent')}
        ${renderMatchMetricChip('Phase', isNetworkMode ? networkMatchPhase : 'local')}
        ${renderMatchMetricChip('Units', `${unitSummary.left + unitSummary.right}`)}
      </div>
      <div class="chip-label">Castles & Units</div>
      <div class="chip-row">
        ${renderResultChip('L HP', `${Math.max(0, left.hp)}/${left.maxHp}`)}
        ${renderResultChip('R HP', `${Math.max(0, right.hp)}/${right.maxHp}`)}
        ${renderResultChip('L Gold', `${left.gold}`, 'secondary')}
        ${renderResultChip('R Gold', `${right.gold}`, 'secondary')}
      </div>
      <div class="chip-label">Result</div>
      <div class="chip-row">
        ${renderResultChip('Match', resultText, resultTone)}
        ${isNetworkMode && networkMatchPhase ? renderResultChip('Network', networkMatchPhase, networkTone) : ''}
      </div>
      <div class="chip-label">Hint</div>
      <div class="chip-row">
        ${isFinished && !isNetworkMode ? renderResultChip('Action', 'Press Restart (or Shift+R)', 'neutral') : renderResultChip('Action', 'Watch battlefield + controls', 'secondary')}
      </div>
      <div class="chip-label">Recent Event</div>
      <div class="chip-row">
        <span class="feedback-chip">${latestEvent}</span>
      </div>
    </section>

    ${renderBattlefieldDetailsSection(state, data)}
  `;

  const canvas = root.querySelector('[data-battlefield-canvas]');
  drawBattlefieldCanvas(canvas, state, data);
}

function createCastleState(castleDef, startingGold) {
  const slots = (castleDef.buildSlots ?? []).map((slot, index) => ({
    index,
    id: slot.id ?? `${castleDef.id}-slot-${index}`,
    x: slot.x,
    y: slot.y,
    buildingTypeId: null,
    buildingHp: 0,
  }));

  for (const [index, buildingTypeId] of (castleDef.startingBuildings ?? []).entries()) {
    if (!slots[index]) break;
    slots[index].buildingTypeId = buildingTypeId;
    slots[index].buildingHp = 0;
  }

  return {
    id: castleDef.id,
    name: castleDef.name,
    laneSide: castleDef.laneSide,
    hp: castleDef.maxHp,
    maxHp: castleDef.maxHp,
    gold: startingGold,
    slots,
  };
}

function createUnitState(unitId, side, typeId, unitType, startPosition, y) {
  return {
    id: unitId,
    side,
    typeId,
    hp: unitType.maxHp,
    maxHp: unitType.maxHp,
    attack: unitType.attack,
    range: unitType.range,
    speed: unitType.speed,
    homeY: y,
    splashRadius: unitType.splashRadius ?? 0,
    splashRatio: unitType.splashRatio ?? 0,
    position: startPosition,
    y,
    blockedTicks: 0,
    sidestepCooldown: 0,
  };
}

const GOLD_TIMELINE_MAX_POINTS = 11;

export function createInitialState(data) {
  const leftCastle = createCastleState(data.castles.left, data.config.startingGold);
  const rightCastle = createCastleState(data.castles.right, data.config.startingGold);

  for (const castle of [leftCastle, rightCastle]) {
    for (const slot of castle.slots ?? []) {
      if (!slot.buildingTypeId) continue;
      slot.buildingHp = getBuildingMaxHp(data, slot.buildingTypeId);
    }
  }

  return {
    stateVersion: 1,
    tick: 0,
    timeMs: 0,
    winner: null,
    battleLane: {
      id: data.battleLane.id,
      length: data.battleLane.length,
      unitIds: [],
    },
    castles: {
      left: leftCastle,
      right: rightCastle,
    },
    events: [],
    units: {},
    nextUnitId: 1,
    debug: {
      selectedUnitId: null,
    },
    ui: {
      nukeUsed: {
        left: false,
        right: false,
      },
      nukeEffect: null,
      selectedBuildSlotBySide: {
        left: 0,
        right: 0,
      },
      singleMode: {
        enabled: false,
        humanSide: 'left',
        aiSide: 'right',
        aiBuildPlan: [],
      },
      network: {
        enabled: false,
        connected: false,
        connecting: false,
        serverUrl: '',
        matchId: 'room-1',
        playerId: '',
        authToken: '',
        side: null,
        ready: false,
        matchStatus: 'offline',
        matchPhase: 'offline',
        sessionToken: null,
        reconnectAttempts: 0,
        reconnectScheduledAtMs: null,
        reconnectScheduledDelayMs: null,
        reconnectMaxAttempts: 8,
        lastError: null,
        connectionHint: null,
        autoReady: false,
        reconnectBanner: null,
        players: {
          left: null,
          right: null,
        },
        commandSeq: 0,
        pendingCommandCount: 0,
        rttMs: null,
        lastSnapshotAtMs: null,
        lastStateTick: 0,
        lastServerTick: 0,
      },
      goldTimeline: {
        points: [{
          tick: 0,
          leftGold: data.config.startingGold,
          rightGold: data.config.startingGold,
          leftDelta: 0,
          rightDelta: 0,
        }],
      },
    },
    commandQueue: [],
  };
}

export function serializeState(state) {
  return JSON.stringify(state);
}

export function deserializeState(serialized) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (!parsed || parsed.stateVersion !== 1) {
    throw new Error('Unsupported state version');
  }
  if (!Array.isArray(parsed.commandQueue)) parsed.commandQueue = [];
  return parsed;
}

function positiveModulo(value, base) {
  return ((value % base) + base) % base;
}

function distance2d(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function clampY(y, halfWidth) {
  return Math.max(-halfWidth, Math.min(halfWidth, y));
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getSimVariant(data) {
  return data.config?.simVariant ?? 0;
}

function getSpawnJitterOffset(data, side, buildingTypeId) {
  const hash = hashText(`${getSimVariant(data)}:${side}:${buildingTypeId}`);
  return (hash % 3) - 1;
}

function getMovementConfig(data) {
  return data.combat?.movement ?? {
    roadHalfWidth: 6,
    spawnSpread: 1.5,
    personalSpace: 1.2,
    blockAheadDistance: 2.2,
    sidestepDistance: 0.9,
    sidestepBlockedTicks: 2,
    sidestepCooldownTicks: 2,
  };
}

function getSpawnY(state, data, side, buildingTypeId) {
  const { roadHalfWidth, spawnSpread } = getMovementConfig(data);
  const hash = hashText(`${getSimVariant(data)}:${side}:${buildingTypeId}:${state.nextUnitId}`);
  const normalized = (hash % 1000) / 999; // 0..1 deterministic
  const spread = spawnSpread * 2;
  const y = (normalized * spread) - spawnSpread;
  return clampY(y, roadHalfWidth);
}

function shouldSpawnOnTick(data, tick, spawnEveryTicks, side, buildingTypeId) {
  const offset = getSpawnJitterOffset(data, side, buildingTypeId);
  return positiveModulo(tick + offset, spawnEveryTicks) === 0;
}

function pushEvent(state, message) {
  const event = `[t${state.tick}] ${message}`;
  state.events.unshift(event);
  if (state.events.length > 5) state.events.pop();
}

function getBuildSlot(castle, slotIndex) {
  if (!castle || slotIndex === null || slotIndex === undefined) return null;
  return castle.slots?.[slotIndex] ?? null;
}

function findFirstEmptySlotIndex(castle) {
  if (!castle?.slots) return null;
  const index = castle.slots.findIndex((slot) => !slot.buildingTypeId);
  return index >= 0 ? index : null;
}

function getBuiltBuildingTypeIds(castle) {
  const ids = [];
  for (const slot of castle?.slots ?? []) {
    if (!slot.buildingTypeId || slot.buildingHp <= 0) continue;
    ids.push(slot.buildingTypeId);
  }
  return ids;
}

function getBuildingMaxHp(data, buildingTypeId) {
  return data.buildingTypes[buildingTypeId]?.maxHp ?? 250;
}

function appendGoldTimelinePoint(state, beforeLeftGold, beforeRightGold) {
  if (!state?.ui) return;
  if (!Array.isArray(state.ui.goldTimeline?.points)) {
    state.ui.goldTimeline = {
      points: [],
    };
  }

  const leftGold = state.castles?.left?.gold ?? beforeLeftGold ?? 0;
  const rightGold = state.castles?.right?.gold ?? beforeRightGold ?? 0;
  const points = state.ui.goldTimeline.points;

  points.push({
    tick: state.tick,
    leftGold,
    rightGold,
    leftDelta: leftGold - beforeLeftGold,
    rightDelta: rightGold - beforeRightGold,
  });

  if (points.length > GOLD_TIMELINE_MAX_POINTS) {
    points.shift();
  }
}

function isAliveBuilding(slot) {
  return Boolean(slot?.buildingTypeId && slot.buildingHp > 0);
}

function getBuildingCost(data, buildingTypeId) {
  return data.buildingTypes[buildingTypeId]?.cost ?? 0;
}

export function canBuild(state, data, side, buildingTypeId, slotIndex = null) {
  const castle = state.castles[side];
  const buildingType = data.buildingTypes[buildingTypeId];
  if (!castle || !buildingType) return false;
  if (castle.gold < buildingType.cost) return false;

  const resolvedSlotIndex = slotIndex ?? findFirstEmptySlotIndex(castle);
  if (resolvedSlotIndex === null) return false;

  const slot = getBuildSlot(castle, resolvedSlotIndex);
  if (!slot || isAliveBuilding(slot)) return false;

  return true;
}

export function buildBuilding(state, data, side, buildingTypeId, slotIndex = null) {
  if (!canBuild(state, data, side, buildingTypeId, slotIndex)) return false;

  const castle = state.castles[side];
  const buildingType = data.buildingTypes[buildingTypeId];
  const resolvedSlotIndex = slotIndex ?? findFirstEmptySlotIndex(castle);
  const slot = getBuildSlot(castle, resolvedSlotIndex);
  if (!slot) return false;

  castle.gold -= buildingType.cost;
  slot.buildingTypeId = buildingTypeId;
  slot.buildingHp = getBuildingMaxHp(data, buildingTypeId);
  pushEvent(state, `${side} built ${buildingTypeId} at slot ${slot.index}`);

  return true;
}

function applyBuildCommand(state, data, payload) {
  const { side, buildingTypeId, slotIndex = null } = payload ?? {};
  if (!side || !buildingTypeId) return false;
  return buildBuilding(state, data, side, buildingTypeId, slotIndex);
}

export function canSell(state, side, slotIndex) {
  const castle = state.castles[side];
  const slot = getBuildSlot(castle, slotIndex);
  return isAliveBuilding(slot);
}

export function canUseNuke(state, side) {
  return side === 'left' || side === 'right'
    ? state?.ui?.nukeUsed?.[side] !== true
    : false;
}

function applyNukeCommand(state, data, payload) {
  const { side } = payload ?? {};
  if (!canUseNuke(state, side)) return false;
  if (side !== 'left' && side !== 'right') return false;

  const opponent = side === 'left' ? 'right' : 'left';
  let removedCount = 0;

  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units[unitId];
    if (!unit || unit.side !== opponent || !unit.hp) continue;
    unit.hp = 0;
    removedCount += 1;
  }

  state.ui.nukeUsed[side] = true;
  state.ui.nukeEffect = {
    side,
    startedAtTick: state.tick,
    durationTicks: 3,
  };
  pushEvent(state, `${side} cast nuke from ${side} side (-${removedCount} enemy unit(s))`);
  return true;
}

export function sellBuilding(state, data, side, slotIndex) {
  if (!canSell(state, side, slotIndex)) return false;

  const castle = state.castles[side];
  const slot = getBuildSlot(castle, slotIndex);
  if (!slot || !slot.buildingTypeId) return false;

  const buildingTypeId = slot.buildingTypeId;
  const refundRatio = data.goldIncome?.sellRefundRatio ?? 0.6;
  const refund = Math.floor(getBuildingCost(data, buildingTypeId) * refundRatio);
  castle.gold += refund;
  slot.buildingTypeId = null;
  slot.buildingHp = 0;
  pushEvent(state, `${side} sold ${buildingTypeId} at slot ${slot.index} (+${refund}g)`);
  return true;
}

function applySellCommand(state, data, payload) {
  const { side, slotIndex } = payload ?? {};
  if (!side || slotIndex === undefined || slotIndex === null) return false;
  return sellBuilding(state, data, side, slotIndex);
}

function applyToggleRuleCommand(data, payload) {
  const { rule, enabled } = payload ?? {};
  if (typeof enabled !== 'boolean') return false;

  if (rule === 'comeback_spawn' && data.combat?.comebackSpawn) {
    data.combat.comebackSpawn.enabled = enabled;
    return true;
  }
  if (rule === 'castle_defense_bonus' && data.combat?.castleDefenseBonus) {
    data.combat.castleDefenseBonus.enabled = enabled;
    return true;
  }

  return false;
}

export function enqueueCommand(state, command) {
  if (!state?.commandQueue || !command?.type) return false;
  state.commandQueue.push(command);
  return true;
}

export function processCommandQueue(state, data) {
  if (!Array.isArray(state.commandQueue) || state.commandQueue.length === 0) return;

  const queued = [...state.commandQueue];
  state.commandQueue.length = 0;

  for (const command of queued) {
    if (!command?.type) continue;
    if (command.type === 'build') {
      applyBuildCommand(state, data, command.payload);
      continue;
    }
    if (command.type === 'sell') {
      applySellCommand(state, data, command.payload);
      continue;
    }
    if (command.type === 'nuke') {
      applyNukeCommand(state, data, command.payload);
      continue;
    }
    if (command.type === 'toggle_rule') {
      applyToggleRuleCommand(data, command.payload);
    }
  }
}

function getIncomeBonus(castle, data) {
  let bonus = 0;
  for (const buildingTypeId of getBuiltBuildingTypeIds(castle)) {
    bonus += data.goldIncome.buildingBonusByType[buildingTypeId] ?? 0;
  }
  return bonus;
}

function applyGoldIncome(state, data) {
  if (state.tick % data.goldIncome.intervalTicks !== 0) return;

  for (const castle of Object.values(state.castles)) {
    castle.gold += data.goldIncome.basePerInterval + getIncomeBonus(castle, data);
  }
}

function spawnUnitForBuilding(state, data, side, buildingTypeId, spawnX, spawnY) {
  const buildingType = data.buildingTypes[buildingTypeId];
  if (!buildingType || buildingType.role !== 'spawn') return;
  if (!shouldSpawnOnTick(data, state.tick, buildingType.spawnEveryTicks, side, buildingTypeId)) return;

  const unitType = data.unitTypes[buildingType.spawnUnitTypeId];
  if (!unitType) return;

  const id = `u${state.nextUnitId}`;
  state.nextUnitId += 1;

  state.units[id] = createUnitState(id, side, unitType.id, unitType, spawnX, spawnY);
  state.battleLane.unitIds.push(id);
  pushEvent(state, `${side} spawned ${unitType.id} (${id}) y ${spawnY.toFixed(1)}`);
}

function collectSpawnRequests(state, data) {
  const requests = [];

  for (const side of ['left', 'right']) {
    const castle = state.castles[side];
    for (const slot of castle.slots ?? []) {
      const buildingTypeId = slot.buildingTypeId;
      if (!isAliveBuilding(slot)) continue;
      const buildingType = data.buildingTypes[buildingTypeId];
      if (!buildingType || buildingType.role !== 'spawn') continue;
      if (!shouldSpawnOnTick(data, state.tick, buildingType.spawnEveryTicks, side, buildingTypeId)) continue;

      requests.push({ side, buildingTypeId, slotIndex: slot.index });
    }
  }

  return requests;
}

function spawnUnits(state, data) {
  const requests = collectSpawnRequests(state, data);
  for (const request of requests) {
    const castle = state.castles[request.side];
    const slot = getBuildSlot(castle, request.slotIndex);
    if (!slot) continue;
    const spawnSpreadY = getSpawnY(state, data, request.side, request.buildingTypeId);
    const spawnY = clampY(slot.y + spawnSpreadY, getMovementConfig(data).roadHalfWidth);
    spawnUnitForBuilding(state, data, request.side, request.buildingTypeId, slot.x, spawnY);
  }
}

function isAliveUnit(unit) {
  return Boolean(unit && unit.hp > 0);
}

function getEnemyUnits(units, side) {
  const enemySide = side === 'left' ? 'right' : 'left';
  return units
    .filter((unit) => isAliveUnit(unit) && unit.side === enemySide);
}

function getEnemyBuildings(state, side) {
  const enemySide = side === 'left' ? 'right' : 'left';
  const enemyCastle = state.castles[enemySide];
  const buildings = [];

  for (const slot of enemyCastle?.slots ?? []) {
    if (!isAliveBuilding(slot)) continue;
    buildings.push({
      side: enemySide,
      slotIndex: slot.index,
      x: slot.x,
      y: slot.y,
      buildingTypeId: slot.buildingTypeId,
    });
  }

  return buildings;
}

function getClosestEnemyInRange(unit, enemies) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const enemy of enemies) {
    const distance = distance2d(unit.position, unit.y, enemy.position, enemy.y);
    if (distance <= unit.range && distance < closestDistance) {
      closest = enemy;
      closestDistance = distance;
    }
  }

  return closest;
}

function getClosestEnemyBuildingInRange(unit, buildings) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const building of buildings) {
    const distance = distance2d(unit.position, unit.y, building.x, building.y);
    if (distance <= unit.range && distance < closestDistance) {
      closest = building;
      closestDistance = distance;
    }
  }

  return closest;
}

function moveTowardEnemyCastle(unit, data) {
  if (unit.side === 'left') {
    unit.position = Math.min(unit.position + unit.speed, data.battleLane.rightCastlePosition);
  } else {
    unit.position = Math.max(unit.position - unit.speed, data.battleLane.leftCastlePosition);
  }
}

function getNearestAllyAheadDistance(unit, unitsSnapshot, data) {
  const { personalSpace, blockAheadDistance } = getMovementConfig(data);
  const allies = unitsSnapshot.filter((other) => other.side === unit.side && other.id !== unit.id);
  if (allies.length === 0) return null;

  let nearestDistance = null;

  if (unit.side === 'left') {
    for (const ally of allies) {
      const dx = ally.position - unit.position;
      const dy = Math.abs(ally.y - unit.y);
      if (dx <= 0 || dx > (unit.speed + blockAheadDistance) || dy > personalSpace) continue;
      if (nearestDistance === null || dx < nearestDistance) {
        nearestDistance = dx;
      }
    }
    return nearestDistance;
  }

  for (const ally of allies) {
    const dx = unit.position - ally.position;
    const dy = Math.abs(ally.y - unit.y);
    if (dx <= 0 || dx > (unit.speed + blockAheadDistance) || dy > personalSpace) continue;
    if (nearestDistance === null || dx < nearestDistance) {
      nearestDistance = dx;
    }
  }

  return nearestDistance;
}

function isBlockedByAlly(unit, unitsSnapshot, data) {
  return getNearestAllyAheadDistance(unit, unitsSnapshot, data) !== null;
}

function moveTowardEnemyCastleByDistance(unit, data, distance) {
  if (distance <= 0) return { ...unit };

  if (unit.side === 'left') {
    return {
      ...unit,
      position: Math.min(unit.position + distance, data.battleLane.rightCastlePosition),
    };
  }

  return {
    ...unit,
    position: Math.max(unit.position - distance, data.battleLane.leftCastlePosition),
  };
}

function recoverUnitYPosition(unit, data) {
  const recovery = getMovementConfig(data).yRecoverySpeed ?? 0.2;
  if (!Number.isFinite(recovery) || recovery <= 0 || unit.homeY === undefined) return;

  const delta = unit.homeY - unit.y;
  if (Math.abs(delta) <= recovery) {
    unit.y = unit.homeY;
    return;
  }

  unit.y += delta > 0 ? recovery : -recovery;
}

function applyLateralSpread(unitsSnapshot, data) {
  const config = getMovementConfig(data);
  const roadHalfWidth = config.roadHalfWidth ?? 6;
  const spreadRadius = config.lateralSpreadRadius ?? 2.4;
  const spreadStrength = config.lateralSpreadStrength ?? 0.22;

  for (const unit of unitsSnapshot) {
    let force = 0;
    let neighborCount = 0;

    for (const other of unitsSnapshot) {
      if (other.id === unit.id) continue;
      if (other.side !== unit.side) continue;

      const dx = Math.abs(other.position - unit.position);
      if (dx > spreadRadius * 2.1) continue;
      const dy = unit.y - other.y;
      const absDy = Math.abs(dy);
      if (absDy >= spreadRadius || absDy < 0.001) continue;

      const normalized = (spreadRadius - absDy) / spreadRadius;
      const influence = normalized * normalized;
      force += dy > 0 ? influence : -influence;
      neighborCount += 1;
    }

    if (neighborCount === 0) continue;

    const nextY = clampY(unit.y + force * spreadStrength, roadHalfWidth - 0.35);
    unit.y = nextY;
  }
}

function canOccupyY(unit, nextY, unitsSnapshot, data) {
  const { personalSpace } = getMovementConfig(data);

  return !unitsSnapshot.some((other) => {
    if (other.id === unit.id) return false;
    if (other.side !== unit.side) return false;
    return distance2d(other.position, other.y, unit.position, nextY) < personalSpace;
  });
}

function maybeSidestepWhenBlocked(unit, unitsSnapshot, data) {
  const config = getMovementConfig(data);
  if (unit.blockedTicks < config.sidestepBlockedTicks) return false;
  if (unit.sidestepCooldown > 0) return false;
  const roadHalfWidth = config.roadHalfWidth ?? 6;
  const personalSpace = config.personalSpace ?? 1.2;
  const seen = new Set();
  const candidates = [];
  const gridStep = config.lateralStep ?? 0.6;
  const halfWidthSafe = roadHalfWidth - 0.25;
  for (let y = -halfWidthSafe; y <= halfWidthSafe; y += gridStep) {
    candidates.push(y);
  }

  let bestY = null;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (const candidateY of candidates) {
    const key = candidateY.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);

    if (!canOccupyY(unit, candidateY, unitsSnapshot, data)) continue;

    let penalty = 0;
    for (const other of unitsSnapshot) {
      if (other.id === unit.id || other.side !== unit.side) continue;
      const dist = distance2d(other.position, other.y, unit.position, candidateY);
      if (dist < personalSpace * 1.5) {
        penalty += 1;
      }
    }
    penalty += Math.abs(candidateY - (unit.homeY ?? unit.y)) * 0.08;
    const deltaToCurrent = Math.abs(candidateY - unit.y);
    penalty += deltaToCurrent * 0.12;

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestY = candidateY;
    }
  }

  if (bestY === null) return false;

  unit.y = bestY;
  unit.blockedTicks = 0;
  unit.sidestepCooldown = config.sidestepCooldownTicks;
  return true;
}

function getCastleDefenseBonus(unit, data) {
  const defenseConfig = data.combat?.castleDefenseBonus;
  if (!defenseConfig) return 0;
  if (defenseConfig.enabled === false) return 0;

  const { laneDistance = 15, bonusAttack = 0 } = defenseConfig;
  const leftCastle = data.battleLane.leftCastlePosition;
  const rightCastle = data.battleLane.rightCastlePosition;

  if (unit.side === 'left') {
    const distanceToOwnCastle = Math.abs(unit.position - leftCastle);
    return distanceToOwnCastle <= laneDistance ? bonusAttack : 0;
  }

  const distanceToOwnCastle = Math.abs(rightCastle - unit.position);
  return distanceToOwnCastle <= laneDistance ? bonusAttack : 0;
}

export function inspectUnit(state, data, unitId) {
  const unit = state.units[unitId];
  if (!isAliveUnit(unit)) return null;

  const snapshot = state.battleLane.unitIds
    .map((id) => state.units[id])
    .filter(isAliveUnit);
  const enemies = getEnemyUnits(snapshot, unit.side);
  const targetUnit = getClosestEnemyInRange(unit, enemies);
  const targetBuilding = targetUnit ? null : getClosestEnemyBuildingInRange(unit, getEnemyBuildings(state, unit.side));
  const blockedByAlly = !targetUnit && !targetBuilding && isBlockedByAlly(unit, snapshot, data);

  let targetId = null;
  let targetDistance = null;
  if (targetUnit) {
    targetId = targetUnit.id;
    targetDistance = distance2d(unit.position, unit.y, targetUnit.position, targetUnit.y);
  } else if (targetBuilding) {
    targetId = `${targetBuilding.side}:slot-${targetBuilding.slotIndex}:${targetBuilding.buildingTypeId}`;
    targetDistance = distance2d(unit.position, unit.y, targetBuilding.x, targetBuilding.y);
  }

  return {
    unitId: unit.id,
    side: unit.side,
    typeId: unit.typeId,
    hp: unit.hp,
    maxHp: unit.maxHp,
    x: unit.position,
    y: unit.y,
    targetId,
    targetDistance,
    blockedByAlly,
    blockedTicks: unit.blockedTicks,
    sidestepCooldown: unit.sidestepCooldown,
    actionHint: targetUnit || targetBuilding ? 'attack' : blockedByAlly ? 'blocked' : 'move',
  };
}

function getEnrageBonus(state) {
  const startTick = 300;
  const interval = 60;
  if (state.tick < startTick) return 0;
  return Math.floor((state.tick - startTick) / interval) + 1;
}

function resolveCombatAndMovement(state, data) {
  const unitsSnapshot = state.battleLane.unitIds
    .map((id) => state.units[id])
    .filter(isAliveUnit);
  applyLateralSpread(unitsSnapshot, data);

  const pendingDamage = new Map();
  const pendingBuildingDamage = new Map();
  const pendingMoves = new Map();
  const enrageBonus = getEnrageBonus(state);
  const addDamage = (targetId, amount) => {
    pendingDamage.set(targetId, (pendingDamage.get(targetId) ?? 0) + amount);
  };
  const addBuildingDamage = (side, slotIndex, amount) => {
    const key = `${side}:${slotIndex}`;
    pendingBuildingDamage.set(key, (pendingBuildingDamage.get(key) ?? 0) + amount);
  };

  for (const unit of unitsSnapshot) {
    const enemies = getEnemyUnits(unitsSnapshot, unit.side);
    const enemyUnitInRange = getClosestEnemyInRange(unit, enemies);
    const enemyBuildingInRange = enemyUnitInRange ? null : getClosestEnemyBuildingInRange(unit, getEnemyBuildings(state, unit.side));
    const totalAttack = unit.attack + enrageBonus + getCastleDefenseBonus(unit, data);

    if (enemyUnitInRange) {
      if (unit.sidestepCooldown > 0) unit.sidestepCooldown -= 1;
      unit.blockedTicks = 0;
      addDamage(enemyUnitInRange.id, totalAttack);

      if (unit.splashRadius > 0 && unit.splashRatio > 0) {
        for (const enemy of enemies) {
          if (enemy.id === enemyUnitInRange.id) continue;

          const splashDistance = distance2d(enemy.position, enemy.y, enemyUnitInRange.position, enemyUnitInRange.y);
          if (splashDistance <= unit.splashRadius) {
            addDamage(enemy.id, totalAttack * unit.splashRatio);
          }
        }
      }
      continue;
    }

    if (enemyBuildingInRange) {
      if (unit.sidestepCooldown > 0) unit.sidestepCooldown -= 1;
      unit.blockedTicks = 0;
      addBuildingDamage(enemyBuildingInRange.side, enemyBuildingInRange.slotIndex, totalAttack);
      continue;
    }

    const blockedDistance = getNearestAllyAheadDistance(unit, unitsSnapshot, data);
    if (blockedDistance !== null) {
      unit.blockedTicks += 1;
      if (unit.sidestepCooldown > 0) unit.sidestepCooldown -= 1;
      const sidestepped = maybeSidestepWhenBlocked(unit, unitsSnapshot, data);
      if (sidestepped) {
        pushEvent(state, `${unit.id} sidestepped to y ${unit.y.toFixed(1)}`);
        unit.blockedTicks = 0;
      } else {
        const movement = getMovementConfig(data);
        const safeGap = Math.max(0.25, movement.personalSpace * 0.6);
        const maxForward = Math.max(0, blockedDistance - safeGap);
        if (maxForward > 0) {
          const step = Math.min(unit.speed, maxForward);
          const moved = moveTowardEnemyCastleByDistance(unit, data, step);
          if (moved.position !== unit.position) {
            pendingMoves.set(unit.id, moved);
            unit.blockedTicks = 0;
            continue;
          }
        }

        const creep = Math.min(unit.speed * 0.25, blockedDistance * 0.8, 0.22);
        if (creep > 0.03) {
          const moved = moveTowardEnemyCastleByDistance(unit, data, creep);
          if (moved.position !== unit.position) {
            pendingMoves.set(unit.id, moved);
            unit.blockedTicks = 0;
          }
        }
      }
      continue;
    }

    const moved = { ...unit };
    moveTowardEnemyCastle(moved, data);
    recoverUnitYPosition(moved, data);
    unit.blockedTicks = 0;
    if (unit.sidestepCooldown > 0) unit.sidestepCooldown -= 1;
    pendingMoves.set(unit.id, moved);
  }

  for (const [targetId, damage] of pendingDamage.entries()) {
    const target = state.units[targetId];
    if (!isAliveUnit(target)) continue;
    const beforeHp = target.hp;
    target.hp -= damage;
    if (beforeHp > 0 && target.hp <= 0) {
      pushEvent(state, `${target.id} defeated`);
    }
  }

  for (const [buildingKey, damage] of pendingBuildingDamage.entries()) {
    const [side, slotIndexText] = buildingKey.split(':');
    const slotIndex = Number(slotIndexText);
    const castle = state.castles[side];
    const slot = getBuildSlot(castle, slotIndex);
    if (!isAliveBuilding(slot)) continue;
    const buildingTypeId = slot.buildingTypeId;
    slot.buildingHp -= damage;
    if (slot.buildingHp <= 0) {
      slot.buildingTypeId = null;
      slot.buildingHp = 0;
      pushEvent(state, `${side} ${buildingTypeId} at slot ${slot.index} destroyed`);
    }
  }

  for (const [unitId, movedUnit] of pendingMoves.entries()) {
    const unit = state.units[unitId];
    if (!isAliveUnit(unit)) continue;
    unit.position = movedUnit.position;
  }
}

function spawnSideUnit(state, data, side, unitTypeId, eventReason) {
  const unitType = data.unitTypes[unitTypeId];
  if (!unitType) return;

  const id = `u${state.nextUnitId}`;
  state.nextUnitId += 1;
  const startPosition = side === 'left' ? data.battleLane.leftCastlePosition : data.battleLane.rightCastlePosition;
  const spawnY = getSpawnY(state, data, side, unitTypeId);

  state.units[id] = createUnitState(id, side, unitType.id, unitType, startPosition, spawnY);
  state.battleLane.unitIds.push(id);
  pushEvent(state, `${side} spawned ${unitType.id} (${id}) y ${spawnY.toFixed(1)}${eventReason ? ` - ${eventReason}` : ''}`);
}

function applyComebackSpawns(state, data) {
  const comebackConfig = data.combat?.comebackSpawn;
  if (!comebackConfig) return;

  const { enabled, hpThresholdRatio, intervalTicks, unitTypeId } = comebackConfig;
  if (!enabled) return;
  if (intervalTicks <= 0 || state.tick % intervalTicks !== 0) return;

  for (const side of ['left', 'right']) {
    const castle = state.castles[side];
    const hpRatio = castle.hp / castle.maxHp;
    if (hpRatio >= hpThresholdRatio) continue;
    spawnSideUnit(state, data, side, unitTypeId, 'comeback');
  }
}

function applyCastleDamageFromReachedUnits(state, data) {
  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units[unitId];
    if (!isAliveUnit(unit)) continue;

    if (unit.side === 'left' && unit.position >= data.battleLane.rightCastlePosition) {
      state.castles.right.hp -= unit.attack;
      unit.hp = 0;
      pushEvent(state, `${unit.id} hit right castle for ${unit.attack}`);
    }

    if (unit.side === 'right' && unit.position <= data.battleLane.leftCastlePosition) {
      state.castles.left.hp -= unit.attack;
      unit.hp = 0;
      pushEvent(state, `${unit.id} hit left castle for ${unit.attack}`);
    }
  }
}

function cleanupDeadUnits(state) {
  const nextIds = [];

  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units[unitId];
    if (isAliveUnit(unit)) {
      nextIds.push(unitId);
    } else {
      delete state.units[unitId];
    }
  }

  state.battleLane.unitIds = nextIds;
}

function updateWinner(state, data) {
  const { left, right } = state.castles;
  if (left.hp <= 0 && right.hp <= 0) {
    state.winner = 'draw';
    pushEvent(state, 'result: draw (both castles destroyed)');
    return;
  }

  if (left.hp <= 0) {
    state.winner = 'right';
    pushEvent(state, 'result: right wins (left castle destroyed)');
    return;
  }

  if (right.hp <= 0) {
    state.winner = 'left';
    pushEvent(state, 'result: left wins (right castle destroyed)');
    return;
  }

  if (state.tick >= data.config.maxTicks) {
    if (left.hp > right.hp) {
      state.winner = 'left';
    } else if (right.hp > left.hp) {
      state.winner = 'right';
    } else {
      state.winner = 'draw';
    }
    pushEvent(state, `result: ${state.winner} by max tick`);
  }
}

export function tick(state, data) {
  processCommandQueue(state, data);
  if (state.winner) return;

  state.tick += 1;
  state.timeMs += data.config.tickMs;
  const beforeLeftGold = state.castles.left?.gold ?? 0;
  const beforeRightGold = state.castles.right?.gold ?? 0;

  applyGoldIncome(state, data);
  spawnUnits(state, data);
  applyComebackSpawns(state, data);
  resolveCombatAndMovement(state, data);
  applyCastleDamageFromReachedUnits(state, data);
  cleanupDeadUnits(state);
  appendGoldTimelinePoint(state, beforeLeftGold, beforeRightGold);
  const nukeEffect = state?.ui?.nukeEffect;
  if (nukeEffect && typeof nukeEffect.startedAtTick === 'number') {
    const duration = nukeEffect.durationTicks ?? 3;
    if (state.tick - nukeEffect.startedAtTick >= duration) {
      state.ui.nukeEffect = null;
    }
  }
  updateWinner(state, data);
}

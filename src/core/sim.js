function createCastleState(castleDef, startingGold) {
  return {
    id: castleDef.id,
    name: castleDef.name,
    laneSide: castleDef.laneSide,
    hp: castleDef.maxHp,
    maxHp: castleDef.maxHp,
    gold: startingGold,
    buildings: [...castleDef.startingBuildings],
  };
}

function createUnitState(unitId, side, typeId, unitType, startPosition) {
  return {
    id: unitId,
    side,
    typeId,
    hp: unitType.maxHp,
    maxHp: unitType.maxHp,
    attack: unitType.attack,
    range: unitType.range,
    speed: unitType.speed,
    position: startPosition,
  };
}

export function createInitialState(data) {
  return {
    tick: 0,
    timeMs: 0,
    winner: null,
    battleLane: {
      id: data.battleLane.id,
      length: data.battleLane.length,
      unitIds: [],
    },
    castles: {
      left: createCastleState(data.castles.left, data.config.startingGold),
      right: createCastleState(data.castles.right, data.config.startingGold),
    },
    units: {},
    nextUnitId: 1,
  };
}

export function canBuild(state, data, side, buildingTypeId) {
  const castle = state.castles[side];
  const buildingType = data.buildingTypes[buildingTypeId];
  if (!castle || !buildingType) return false;
  return castle.gold >= buildingType.cost;
}

export function buildBuilding(state, data, side, buildingTypeId) {
  if (!canBuild(state, data, side, buildingTypeId)) return false;

  const castle = state.castles[side];
  const buildingType = data.buildingTypes[buildingTypeId];

  castle.gold -= buildingType.cost;
  castle.buildings.push(buildingTypeId);

  return true;
}

function getIncomeBonus(castle, data) {
  let bonus = 0;
  for (const buildingTypeId of castle.buildings) {
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

function spawnUnitForBuilding(state, data, side, buildingTypeId) {
  const buildingType = data.buildingTypes[buildingTypeId];
  if (!buildingType || buildingType.role !== 'spawn') return;
  if (state.tick % buildingType.spawnEveryTicks !== 0) return;

  const unitType = data.unitTypes[buildingType.spawnUnitTypeId];
  if (!unitType) return;

  const id = `u${state.nextUnitId}`;
  state.nextUnitId += 1;

  const startPosition = side === 'left' ? data.battleLane.leftCastlePosition : data.battleLane.rightCastlePosition;
  state.units[id] = createUnitState(id, side, unitType.id, unitType, startPosition);
  state.battleLane.unitIds.push(id);
}

function collectSpawnRequests(state, data) {
  const requests = [];

  for (const side of ['left', 'right']) {
    const castle = state.castles[side];
    for (const buildingTypeId of castle.buildings) {
      const buildingType = data.buildingTypes[buildingTypeId];
      if (!buildingType || buildingType.role !== 'spawn') continue;
      if (state.tick % buildingType.spawnEveryTicks !== 0) continue;

      requests.push({ side, buildingTypeId });
    }
  }

  return requests;
}

function spawnUnits(state, data) {
  const requests = collectSpawnRequests(state, data);
  for (const request of requests) {
    spawnUnitForBuilding(state, data, request.side, request.buildingTypeId);
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

function getClosestEnemyInRange(unit, enemies) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const enemy of enemies) {
    const distance = Math.abs(enemy.position - unit.position);
    if (distance <= unit.range && distance < closestDistance) {
      closest = enemy;
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

function resolveCombatAndMovement(state, data) {
  const unitsSnapshot = state.battleLane.unitIds
    .map((id) => state.units[id])
    .filter(isAliveUnit);

  const pendingDamage = new Map();
  const pendingMoves = new Map();

  for (const unit of unitsSnapshot) {
    const enemies = getEnemyUnits(unitsSnapshot, unit.side);
    const enemyInRange = getClosestEnemyInRange(unit, enemies);

    if (enemyInRange) {
      pendingDamage.set(enemyInRange.id, (pendingDamage.get(enemyInRange.id) ?? 0) + unit.attack);
      continue;
    }

    const moved = { ...unit };
    moveTowardEnemyCastle(moved, data);
    pendingMoves.set(unit.id, moved.position);
  }

  for (const [targetId, damage] of pendingDamage.entries()) {
    const target = state.units[targetId];
    if (!isAliveUnit(target)) continue;
    target.hp -= damage;
  }

  for (const [unitId, nextPosition] of pendingMoves.entries()) {
    const unit = state.units[unitId];
    if (!isAliveUnit(unit)) continue;
    unit.position = nextPosition;
  }
}

function applyCastleDamageFromReachedUnits(state, data) {
  for (const unitId of state.battleLane.unitIds) {
    const unit = state.units[unitId];
    if (!isAliveUnit(unit)) continue;

    if (unit.side === 'left' && unit.position >= data.battleLane.rightCastlePosition) {
      state.castles.right.hp -= unit.attack;
      unit.hp = 0;
    }

    if (unit.side === 'right' && unit.position <= data.battleLane.leftCastlePosition) {
      state.castles.left.hp -= unit.attack;
      unit.hp = 0;
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
    return;
  }

  if (left.hp <= 0) {
    state.winner = 'right';
    return;
  }

  if (right.hp <= 0) {
    state.winner = 'left';
    return;
  }

  if (state.tick >= data.config.maxTicks) {
    state.winner = left.hp === right.hp ? 'draw' : left.hp > right.hp ? 'left' : 'right';
  }
}

export function tick(state, data) {
  if (state.winner) return;

  state.tick += 1;
  state.timeMs += data.config.tickMs;

  applyGoldIncome(state, data);
  spawnUnits(state, data);
  resolveCombatAndMovement(state, data);
  applyCastleDamageFromReachedUnits(state, data);
  cleanupDeadUnits(state);
  updateWinner(state, data);
}

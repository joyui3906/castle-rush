export const GAME_DATA = {
  config: {
    tickMs: 500,
    startingGold: 100,
    maxTicks: 1200,
  },

  goldIncome: {
    intervalTicks: 2,
    basePerInterval: 5,
    buildingBonusByType: {
      income_mine: 3,
    },
  },

  battleLane: {
    id: 'lane-1',
    length: 100,
    leftCastlePosition: 0,
    rightCastlePosition: 100,
  },

  castles: {
    left: {
      id: 'left',
      name: 'Left Castle',
      maxHp: 1000,
      laneSide: 'left',
      startingBuildings: ['income_mine', 'barracks', 'range_tower'],
    },
    right: {
      id: 'right',
      name: 'Right Castle',
      maxHp: 1000,
      laneSide: 'right',
      startingBuildings: ['income_mine', 'barracks', 'range_tower'],
    },
  },

  buildingTypes: {
    income_mine: {
      id: 'income_mine',
      role: 'economy',
      cost: 50,
      spawnUnitTypeId: null,
      spawnEveryTicks: null,
    },
    barracks: {
      id: 'barracks',
      role: 'spawn',
      cost: 75,
      spawnUnitTypeId: 'swordsman',
      spawnEveryTicks: 4,
    },
    range_tower: {
      id: 'range_tower',
      role: 'spawn',
      cost: 90,
      spawnUnitTypeId: 'archer',
      spawnEveryTicks: 6,
    },
    tank_forge: {
      id: 'tank_forge',
      role: 'spawn',
      cost: 110,
      spawnUnitTypeId: 'guardian',
      spawnEveryTicks: 8,
    },
    splash_tower: {
      id: 'splash_tower',
      role: 'spawn',
      cost: 130,
      spawnUnitTypeId: 'mage',
      spawnEveryTicks: 10,
    },
  },

  unitTypes: {
    swordsman: { id: 'swordsman', role: 'melee', maxHp: 90, attack: 14, range: 1, speed: 2 },
    archer: { id: 'archer', role: 'ranged', maxHp: 60, attack: 12, range: 7, speed: 2 },
    guardian: { id: 'guardian', role: 'tank', maxHp: 150, attack: 8, range: 1, speed: 1 },
    spearman: { id: 'spearman', role: 'melee', maxHp: 80, attack: 13, range: 2, speed: 2 },
    scout: { id: 'scout', role: 'light', maxHp: 50, attack: 9, range: 1, speed: 3 },
    mage: { id: 'mage', role: 'ranged', maxHp: 55, attack: 16, range: 6, speed: 2, splashRadius: 3, splashRatio: 0.5 },
  },
};

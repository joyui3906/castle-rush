import { buildBuilding, canBuild } from '../core/sim.js';

const BUILD_OPTIONS = ['income_mine', 'barracks'];

function makeBuildButton({ side, buildingTypeId, cost, onBuild, enabled }) {
  const disabled = enabled ? '' : 'disabled';
  return `<button data-side="${side}" data-building="${buildingTypeId}" ${disabled}>${side} build ${buildingTypeId} (${cost}g)</button>`;
}

function renderControlsHtml(state, data) {
  const rows = ['left', 'right'].map((side) => {
    const buttons = BUILD_OPTIONS.map((buildingTypeId) => {
      const cost = data.buildingTypes[buildingTypeId].cost;
      const enabled = canBuild(state, data, side, buildingTypeId);
      return makeBuildButton({ side, buildingTypeId, cost, enabled });
    }).join('');

    return `<div class="controls-row"><strong>${side.toUpperCase()}</strong> ${buttons}</div>`;
  });

  return `<h2>Build Controls</h2>${rows.join('')}`;
}

export function setupControls(root, state, data, rerender) {
  if (!root) return;

  const onClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const side = target.dataset.side;
    const buildingTypeId = target.dataset.building;
    if (!side || !buildingTypeId) return;

    const built = buildBuilding(state, data, side, buildingTypeId);
    if (built) rerender();
  };

  root.addEventListener('click', onClick);

  return () => {
    root.innerHTML = renderControlsHtml(state, data);
  };
}

import { GAME_DATA } from './data/game-data.js';
import { createInitialState, tick } from './core/sim.js';
import { render } from './render/render.js';
import { setupControls } from './ui/controls.js';

const root = document.querySelector('#app');
const controlsRoot = document.querySelector('#controls');
const state = createInitialState(GAME_DATA);

const rerender = () => {
  render(root, state, GAME_DATA);
  renderControls();
};

const renderControls = setupControls(controlsRoot, state, GAME_DATA, rerender);

rerender();

setInterval(() => {
  tick(state, GAME_DATA);
  rerender();
}, GAME_DATA.config.tickMs);

import { GAME_DATA } from './data/game-data.js';
import { createInitialState, tick } from './core/sim.js';
import { render } from './render/render.js';

const root = document.querySelector('#app');
const state = createInitialState(GAME_DATA);

render(root, state, GAME_DATA);

setInterval(() => {
  tick(state, GAME_DATA);
  render(root, state, GAME_DATA);
}, GAME_DATA.config.tickMs);

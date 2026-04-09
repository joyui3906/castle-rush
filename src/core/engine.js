import {
  createInitialState,
  tick,
  enqueueCommand,
  processCommandQueue,
  serializeState,
  deserializeState,
} from './sim.js';

export function createEngine(data, initialState = null) {
  const state = initialState ? deserializeState(initialState) : createInitialState(data);
  return {
    data,
    state,
  };
}

export function dispatch(engine, command) {
  return enqueueCommand(engine.state, command);
}

export function flushCommands(engine) {
  processCommandQueue(engine.state, engine.data);
}

export function update(engine) {
  tick(engine.state, engine.data);
}

export function saveEngineState(engine) {
  return serializeState(engine.state);
}

/**
 * Project OMNISCIENCE — Universal Scientific Simulation Engine.
 *
 * Main entry point re-exporting every domain and the core engine.
 */

// Core engine
export { Model, Simulator, Coupler, Registry, EventEmitter } from './core/index.js';

// Domains
export { NBody, body, G } from './mechanics/index.js';
export { NavierStokes, cellGrid } from './fluids/index.js';
export { Chemistry, reaction, R } from './chemistry/index.js';
export { ElementaryCA, GameOfLife } from './ca/index.js';
export { LotkaVolterra, World } from './ecosystem/index.js';

// Coupling
export { VariableMapper, chain } from './coupling/index.js';

// Experiments
export { Experiment, ParameterSweep } from './experiments/index.js';

// Visualization
export { renderGrid, renderCA, renderTimeSeries, toCSV, writeCSV } from './visualization/index.js';

import { Model, Simulator, Coupler as CoreCoupler, Registry } from './core/index.js';
import { NBody } from './mechanics/index.js';
import { NavierStokes } from './fluids/index.js';
import { Chemistry } from './chemistry/index.js';
import { ElementaryCA, GameOfLife } from './ca/index.js';
import { LotkaVolterra, World } from './ecosystem/index.js';
import { VariableMapper } from './coupling/index.js';
import { Experiment, ParameterSweep } from './experiments/index.js';

export default {
  Model,
  Simulator,
  Coupler: CoreCoupler,
  Registry,
  NBody,
  NavierStokes,
  Chemistry,
  ElementaryCA,
  GameOfLife,
  LotkaVolterra,
  World,
  VariableMapper,
  Experiment,
  ParameterSweep,
};

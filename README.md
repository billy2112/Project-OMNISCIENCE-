# Project OMNISCIENCE — A Universal Scientific Simulation Engine

A modular simulation environment where different scientific systems
(classical mechanics, fluid dynamics, chemical reactions, cellular automata,
ecosystems) interact through a common engine for connecting models, running
experiments, and studying emergent behavior.

## Structure

- `src/core` — engine: Model, Simulator, Coupler, Experiment, Registry
- `src/mechanics` — classical mechanics (N-body, particles)
- `src/fluids` — fluid dynamics (Navier–Stokes on a grid)
- `src/chemistry` — chemical reaction systems (ODE mass-action kinetics)
- `src/ca` — cellular automata (Game of Life, elementary CA)
- `src/ecosystem` — ecosystem simulations (Lotka–Volterra, world grid)
- `src/coupling` — connecting models via variable mapping
- `src/experiments` — parameter sweeps and experiment runner
- `src/visualization` — lightweight ASCII/CSV visualization helpers
- `tests` — test suite
- `demo` — example scripts

## Quick start

```bash
npm install
node demo/run.mjs
```

## Core API

```js
import { Simulator } from './src/core/index.js';
import { NBody } from './src/mechanics/index.js';
import { Chemistry } from './src/chemistry/index.js';
import { Coupler } from './src/coupling/index.js';

const sim = new Simulator({ dt: 0.01 });
const mechanics = new NBody({ bodies: [...] });
const chemistry = new Chemistry({ reactions: [...] });

sim.addModel(mechanics);
sim.addModel(chemistry);

// couple temperature (chemistry) -> damping (mechanics)
const coupler = new Coupler();
coupler.connect(chemistry, 'temperature', mechanics, 'thermalDamping', v => v * 0.1);
sim.addCoupler(coupler);

sim.run(10.0);
```

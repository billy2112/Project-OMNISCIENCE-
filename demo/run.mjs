/**
 * Project OMNISCIENCE — Demo.
 *
 * Runs four mini-experiments:
 *   1. Classical mechanics — N-body (Sun + Earth + Moon)
 *   2. Fluid dynamics — dye injection in a Navier–Stokes flow
 *   3. Chemistry — Lotka-style chemical oscillator (A -> B -> C)
 *   4. Emergence — Game of Life glider
 *   5. Coupled experiment — chemistry temperature drives mechanics damping
 */

import { Simulator, NBody, body, NavierStokes, Chemistry, GameOfLife, LotkaVolterra, Coupler, Experiment, ParameterSweep, renderGrid, renderCA } from '../src/index.js';

function format(t) {
  return t.toFixed(3);
}

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║  Project OMNISCIENCE — Universal Scientific Simulation Engine  ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

// ------------------------------------------------------------------
// 1. Classical mechanics: three-body gravitational system
// ------------------------------------------------------------------
console.log('--- 1. Classical mechanics: N-body gravity ---');
const mechanics = new NBody({
  bodies: [
    body({ id: 'sun', mass: 1000, position: [0, 0, 0], velocity: [0, 0, 0] }),
    body({ id: 'earth', mass: 1, position: [120, 0, 0], velocity: [0, 30, 0] }),
    body({ id: 'moon', mass: 0.01, position: [130, 0, 0], velocity: [0, 32, 0] }),
  ],
  softening: 1e-2,
});
const sim1 = new Simulator({ dt: 0.05 });
sim1.addModel(mechanics);
sim1.run(5.0);
const e0 = mechanics.bodiesSnapshot[1];
const e1 = mechanics.bodiesSnapshot[1];
console.log(`Earth orbit energy check: E_kin=${mechanics.kineticEnergy().toFixed(3)} E_pot=${mechanics.potentialEnergy().toFixed(3)}`);
console.log(`Earth final position: [${mechanics.bodiesSnapshot[1].position.map(format).join(', ')}]\n`);

// ------------------------------------------------------------------
// 2. Fluid dynamics: dye plume with buoyancy
// ------------------------------------------------------------------
console.log('--- 2. Fluid dynamics: 2D Navier–Stokes ---');
const fluids = new NavierStokes({ width: 40, height: 24, dt: 0.2, viscosity: 0.0005, buoyancyFactor: 0.2 });
fluids.addDensity(20, 12, 5);
fluids.addVelocity(20, 12, 2, 1);
const sim2 = new Simulator({ dt: 0.2 });
sim2.addModel(fluids);
sim2.run(4.0);
const grid = fluids.getGrid();
console.log(renderGrid(grid, (cell) => {
  if (cell.density > 1) return '█';
  if (cell.density > 0.3) return '▓';
  if (cell.density > 0.05) return '░';
  return ' ';
}, 40));
console.log(`\nMax density: ${Math.max(...grid.flat().map((c) => c.density)).toFixed(3)}\n`);

// ------------------------------------------------------------------
// 3. Chemical reaction system: sequential decay A -> B -> C
// ------------------------------------------------------------------
console.log('--- 3. Chemical kinetics: A -> B -> C ---');
const chem = new Chemistry({
  species: ['A', 'B', 'C'],
  reactions: [
    { id: 'r1', reactants: { A: 1 }, products: { B: 1 }, rate: 0.6 },
    { id: 'r2', reactants: { B: 1 }, products: { C: 1 }, rate: 0.3 },
  ],
  temperature: 300,
});
chem.setConcentration('A', 1.0);
const sim3 = new Simulator({ dt: 0.05 });
sim3.addModel(chem);
sim3.run(10.0);
console.log(`A=${chem.getConcentration('A').toFixed(4)} B=${chem.getConcentration('B').toFixed(4)} C=${chem.getConcentration('C').toFixed(4)}`);
console.log(`rates: r1=${chem.getRate('r1').toFixed(4)} r2=${chem.getRate('r2').toFixed(4)}\n`);

// ------------------------------------------------------------------
// 4. Cellular automata: Game of Life glider
// ------------------------------------------------------------------
console.log('--- 4. Cellular automata: Game of Life glider ---');
const life = new GameOfLife({ width: 24, height: 12, seed: 'glider' });
const sim4 = new Simulator({ dt: 1, recordHistory: false });
sim4.addModel(life);
for (let g = 0; g < 8; g++) {
  console.log(`gen ${life.state.generation}:`);
  console.log(renderGrid(life.getGrid(), (cell) => (cell ? '█' : '·'), 24));
  sim4.step();
}
console.log();

// ------------------------------------------------------------------
// 5. Coupled experiment: temperature (chemistry) -> damping (mechanics)
// ------------------------------------------------------------------
console.log('--- 5. Cross-domain coupling: chemistry temperature drives drag ---');
const mech2 = new NBody({ bodies: [body({ id: 'p1', mass: 1, position: [10, 0, 0], velocity: [0, 15, 0] }), body({ id: 'p2', mass: 100, position: [0, 0, 0], velocity: [0, 0, 0] })], damping: 0 });
const chem2 = new Chemistry({ species: ['A', 'B'], reactions: [{ id: 'rxn', reactants: { A: 1 }, products: { B: 1 }, rate: 0.2 }], temperature: 400 });
chem2.setConcentration('A', 1.0);
const sim5 = new Simulator({ dt: 0.05 });
sim5.addModel(mech2);
sim5.addModel(chem2);
const coupler = new Coupler();
// chemistry temperature -> mechanics thermal damping
coupler.connect(chem2, 'temperature', mech2, 'thermalDamping', (t) => Math.max(0, (t - 300) / 20000));
// mechanics kinetic energy -> chemistry temperature (feedback)
coupler.connect(mech2, 'kineticEnergy', chem2, 'temperature', (ke) => 300 + Math.min(ke, 200));
sim5.addCoupler(coupler);
sim5.run(10.0);
console.log(`Final: temperature=${chem2.state.temperature.toFixed(2)} K, damping=${mech2.state.thermalDamping.toFixed(6)}, KE=${mech2.kineticEnergy().toFixed(3)}\n`);

// ------------------------------------------------------------------
// 6. Parameter sweep: Lotka-Volterra predation sensitivity
// ------------------------------------------------------------------
console.log('--- 6. Parameter sweep: Lotka–Volterra beta sensitivity ---');
const sweep = new ParameterSweep({
  name: 'lotka-volterra',
  options: { beta: [0.005, 0.01, 0.02], delta: [0.0025, 0.005] },
  experiment: new Experiment({
    name: 'lv-run',
    buildSimulator: (params) => {
      const lv = new LotkaVolterra({ ...params, prey: 40, predator: 9 });
      const sim = new Simulator({ dt: 0.1, recordHistory: false });
      sim.addModel(lv);
      return sim;
    },
    duration: 100,
    metrics: (sim) => {
      const lv = sim.models[0];
      return { peakPrey: lv.state.prey, finalPredator: lv.state.predator };
    },
  }),
});
sweep.run();
console.table(sweep.toTable(['peakPrey', 'finalPredator']));

console.log('\nDemo complete.');

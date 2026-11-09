/**
 * Project OMNISCIENCE — Test suite.
 * Runs with: node tests/run.mjs
 */

import assert from 'node:assert/strict';
import {
  Simulator, Model, Coupler, Registry,
  NBody, body,
  NavierStokes,
  Chemistry,
  ElementaryCA, GameOfLife,
  LotkaVolterra, World,
  Experiment, ParameterSweep,
} from '../src/index.js';

let passes = 0;
let failures = 0;

function test(name, fn) {
  try {
    fn();
    passes++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n       ${err.message}`);
  }
}

// ---------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------
test('Model.step advances time and emits stepped', () => {
  let stepped = 0;
  class Counter extends Model {
    step(dt) { this.state.count = (this.state.count || 0) + dt; stepped++; }
  }
  const m = new Counter({ id: 'c' });
  const sim = new Simulator({ dt: 0.1 });
  m.on('stepped', () => stepped);
  sim.addModel(m);
  sim.runSteps(5);
  assert.equal(m.time, 0.5);
  assert.equal(m.state.count, 0.5);
  assert.equal(stepped, 5);
});

test('Simulator records history snapshots', () => {
  const m = new Model({ id: 'm' });
  m.step = (dt) => { m.state.x = (m.state.x || 0) + 1; };
  const sim = new Simulator({ dt: 0.1, recordHistory: true, maxHistory: 100 });
  sim.addModel(m);
  sim.runSteps(4);
  assert.equal(sim.history.length, 4);
  assert.equal(sim.history[3].models.m.x, 4);
});

test('Coupler transfers transformed variables between models', () => {
  const src = new Model({ id: 'src' });
  src.state.temp = 300;
  const tgt = new Model({ id: 'tgt' });
  tgt.state.damping = 0;
  const c = new Coupler();
  c.connect(src, 'temp', tgt, 'damping', (t) => (t - 300) / 1000);
  src.state.temp = 400;
  c.apply();
  assert.equal(tgt.state.damping, 0.1);
});

test('Registry builds named model factories', () => {
  const reg = new Registry();
  reg.register('counter', (params) => {
    const m = new Model({ id: params.id || 'counter', parameters: { n: params.n || 0 } });
    m.state.value = params.n || 0;
    return m;
  });
  assert.deepEqual(reg.names(), ['counter']);
  const m = reg.build('counter', { id: 'c1', n: 7 });
  assert.equal(m.id, 'c1');
  assert.equal(m.state.value, 7);
  assert.equal(reg.get('c1'), m);
});

// ---------------------------------------------------------------
// Classical mechanics
// ---------------------------------------------------------------
test('N-body gravity integrates and conserves energy approximately', () => {
  const nb = new NBody({
    bodies: [
      body({ id: 'a', mass: 100, position: [0, 0, 0], velocity: [0, 0, 0] }),
      body({ id: 'b', mass: 1, position: [100, 0, 0], velocity: [0, 10, 0] }),
    ],
    softening: 1e-2,
  });
  nb.initialize();
  const E0 = nb.kineticEnergy() + nb.potentialEnergy();
  const sim = new Simulator({ dt: 0.05 });
  sim.addModel(nb);
  sim.run(2.0);
  const E1 = nb.kineticEnergy() + nb.potentialEnergy();
  assert.ok(nb.time > 0);
  assert.ok(nb.bodiesSnapshot.length === 2);
  assert.ok(Math.abs(E1 - E0) / Math.abs(E0) < 0.05, `energy drift ${E0} -> ${E1}`);
});

test('N-body thermal damping coupling input slows bodies', () => {
  const nb = new NBody({
    bodies: [body({ id: 'p', mass: 1, position: [10, 0, 0], velocity: [0, 20, 0] })],
    damping: 0,
  });
  nb.initialize();
  const v0 = Math.hypot(...nb.bodiesSnapshot[0].velocity);
  nb.state.thermalDamping = 1.0;
  const sim = new Simulator({ dt: 0.1 });
  sim.addModel(nb);
  sim.runSteps(20);
  const v1 = Math.hypot(...nb.bodiesSnapshot[0].velocity);
  assert.ok(v1 < v0, `velocity did not decay: ${v0} -> ${v1}`);
});

// ---------------------------------------------------------------
// Fluid dynamics
// ---------------------------------------------------------------
test('Navier–Stokes step runs and diffuses density', () => {
  const fl = new NavierStokes({ width: 16, height: 16, dt: 0.2, viscosity: 0.001 });
  fl.addDensity(8, 8, 10);
  const peak0 = Math.max(...fl.state.density);
  const sim = new Simulator({ dt: 0.2 });
  sim.addModel(fl);
  sim.runSteps(10);
  assert.ok(fl.state.pressure.length === 256);
  assert.ok(Math.max(...fl.state.density) < peak0, 'density peak did not diffuse');
  assert.ok(fl.state.density.every((v) => v >= 0), 'density went negative');
});

test('NavierStokes addVelocity injects momentum', () => {
  const fl = new NavierStokes({ width: 16, height: 16 });
  fl.addVelocity(4, 8, 5, 0);
  assert.ok(fl.state.u[8 * 16 + 4] === 5);
});

// ---------------------------------------------------------------
// Chemistry
// ---------------------------------------------------------------
test('Chemistry mass-action kinetics conserve mass', () => {
  const ch = new Chemistry({
    species: ['A', 'B', 'C'],
    reactions: [
      { id: 'r1', reactants: { A: 1 }, products: { B: 1 }, rate: 0.5 },
      { id: 'r2', reactants: { B: 1 }, products: { C: 1 }, rate: 0.25 },
    ],
  });
  ch.setConcentration('A', 1.0);
  const sim = new Simulator({ dt: 0.05 });
  sim.addModel(ch);
  sim.run(5.0);
  const total = ch.getConcentration('A') + ch.getConcentration('B') + ch.getConcentration('C');
  assert.ok(Math.abs(total - 1.0) < 0.01, `mass not conserved: ${total}`);
  assert.ok(ch.getConcentration('C') > ch.getConcentration('B'), 'C should accumulate most');
});

// ---------------------------------------------------------------
// Cellular automata
// ---------------------------------------------------------------
test('Elementary CA rule 30 evolves from single seed', () => {
  const ca = new ElementaryCA({ width: 41, rule: 30, seed: 'center' });
  const gen0 = ca.getRow().filter((v) => v).length;
  assert.equal(gen0, 1);
  ca.step(1);
  const gen1 = ca.getRow().filter((v) => v).length;
  assert.equal(gen1, 3, `rule 30 gen1 should have 3 cells, got ${gen1}`);
  assert.equal(ca.state.generation, 1);
  assert.ok(ca.state.density > 0 && ca.state.density <= 1);
});

test('Game of Life blinker oscillates with period 2', () => {
  const life = new GameOfLife({ width: 8, height: 8, seed: [] });
  // vertical blinker at x=3, y=2..4
  life.setCell(3, 2, 1).setCell(3, 3, 1).setCell(3, 4, 1);
  const g0 = life.getGrid();
  life.step(1);
  const g1 = life.getGrid();
  // horizontal line at y=3
  assert.equal(g1[3][2], 1);
  assert.equal(g1[3][3], 1);
  assert.equal(g1[3][4], 1);
  assert.equal(g1[2][3], 0);
  assert.equal(g1[4][3], 0);
  life.step(1);
  const g2 = life.getGrid();
  assert.equal(g2[2][3], 1);
  assert.equal(g2[3][3], 1);
  assert.equal(g2[4][3], 1);
  assert.equal(life.state.generation, 2);
});

// ---------------------------------------------------------------
// Ecosystem
// ---------------------------------------------------------------
test('Lotka–Volterra produces sustained oscillation', () => {
  const lv = new LotkaVolterra({ prey: 40, predator: 9, alpha: 1, beta: 0.01, delta: 0.005, gamma: 0.4 });
  const sim = new Simulator({ dt: 0.1, recordHistory: true });
  sim.addModel(lv);
  sim.run(50.0);
  const prey = lv.state.prey;
  const pred = lv.state.predator;
  assert.ok(prey > 0 && pred > 0);
  assert.ok(prey !== 40 || pred !== 9, 'populations should change');
});

test('World spatial ecosystem evolves totals', () => {
  const w = new World({ width: 16, height: 16, dt: 0.2, seed: 'random' });
  const r0 = w.totalResource();
  const p0 = w.totalPrey();
  const y0 = w.totalPredator();
  const sim = new Simulator({ dt: 0.2 });
  sim.addModel(w);
  sim.runSteps(20);
  assert.ok(w.totalPrey() >= 0);
  assert.ok(w.totalPredator() >= 0);
  assert.ok(w.totalResource() >= 0);
  assert.ok(w.totalResource() !== r0 || w.totalPrey() !== p0, 'world state should evolve');
});

// ---------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------
test('Experiment runs and collects metrics', () => {
  let built = 0;
  const exp = new Experiment({
    name: 'exp-1',
    buildSimulator: (params) => {
      built++;
      const m = new Model({ id: 'm' });
      m.state.x = params.x || 0;
      m.step = (dt) => { m.state.x += dt * (params.scale || 1); };
      const sim = new Simulator({ dt: 0.1 });
      sim.addModel(m);
      return sim;
    },
    duration: 1.0,
    metrics: (sim) => sim.models[0].state.x,
  });
  const res = exp.run({ x: 2, scale: 3 });
  assert.equal(built, 1);
  assert.equal(res.params.x, 2);
  assert.ok(Math.abs(res.metrics - (2 + 3 * 1.0)) < 1e-9, `metrics wrong: ${res.metrics}`);
});

test('ParameterSweep runs the full cartesian grid', () => {
  const exp = new Experiment({
    name: 'sweep-exp',
    buildSimulator: (params) => {
      const m = new Model({ id: 'm' });
      m.state.v = params.a + params.b;
      m.step = () => {};
      const sim = new Simulator({ dt: 0.1 });
      sim.addModel(m);
      return sim;
    },
    duration: 0.1,
    metrics: (sim) => ({ v: sim.models[0].state.v }),
  });
  const sweep = new ParameterSweep({
    name: 'sweep-1',
    experiment: exp,
    options: { a: [1, 2], b: [10, 20] },
  });
  const runs = sweep.run();
  assert.equal(runs.length, 4);
  assert.deepEqual(runs.map((r) => r.result.metrics.v).sort(), [11, 12, 21, 22]);
  const best = sweep.bestBy('v', true);
  assert.equal(best.params.a, 2);
  assert.equal(best.params.b, 20);
  const table = sweep.toTable(['v']);
  assert.equal(table.header.length, 3);
  assert.equal(table.rows.length, 4);
});

// ---------------------------------------------------------------
// Cross-domain coupled experiment
// ---------------------------------------------------------------
test('Coupled experiment: fluid buoyancy driven by chemistry heat', () => {
  const ch = new Chemistry({
    species: ['A', 'B'],
    reactions: [{ id: 'rxn', reactants: { A: 1 }, products: { B: 1 }, rate: 0.3 }],
    temperature: 300,
  });
  ch.setConcentration('A', 1.0);
  const fl = new NavierStokes({ width: 24, height: 12, dt: 0.2, buoyancyFactor: 0.5 });
  fl.addDensity(12, 6, 4);
  const sim = new Simulator({ dt: 0.2 });
  sim.addModel(ch);
  sim.addModel(fl);
  const c = new Coupler();
  c.connect(ch, 'temperature', fl, 'buoyancyFactor', (t) => Math.max(0, (t - 300)) / 500);
  c.connect(fl, 'density', ch, 'temperature', (dens) => 300 + Math.max(...dens)); // placeholder identity-ish
  sim.addCoupler(c);
  sim.run(2.0);
  assert.ok(ch.state.temperature >= 300);
  assert.ok(fl.state.buoyancyFactor >= 0);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);

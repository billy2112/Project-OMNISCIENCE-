/**
 * Project OMNISCIENCE — Ecosystem simulation domain.
 *
 * Lotka–Volterra predator–prey dynamics (continuous ODE, RK4 integrated) plus
 * a simple spatial world grid where prey and predator densities diffuse,
 * reproduce and consume locally.
 *
 * LotkaVolterra state:
 *   state.prey, state.predator : population densities
 *   state.time
 *
 * World state:
 *   state.preyGrid, state.predatorGrid, state.resourceGrid : Float64Array (w*h)
 *   state.width, state.height
 *
 * Coupling hooks:
 *   state.temperature (World) scales metabolic rates;
 *   LotkaVolterra exposes state.carryingCapacity that a chemistry model can
 *   alter via a coupler.
 */

import { Model } from '../core/index.js';

/* ------------------------------------------------------------------ */
/* Lotka–Volterra predator–prey                                       */
/* ------------------------------------------------------------------ */

/**
 * dPrey/dt   = alpha * prey - beta * prey * predator
 * dPred/dt   = delta * prey * predator - gamma * predator
 */
export class LotkaVolterra extends Model {
  constructor({
    prey = 40,
    predator = 9,
    alpha = 1.0,   // prey growth rate
    beta = 0.01,   // predation rate
    delta = 0.005, // predator reproduction per prey eaten
    gamma = 0.4,   // predator death rate
    carryingCapacity = 500,
  } = {}) {
    super({
      id: 'lotkavolterra',
      name: 'Lotka–Volterra predator–prey',
      parameters: { alpha, beta, delta, gamma, carryingCapacity },
    });
    this.state.prey = prey;
    this.state.predator = predator;
    this.state.carryingCapacity = carryingCapacity;
    this.state.time = 0;
    this.state.alpha = alpha;
    this.state.beta = beta;
    this.state.delta = delta;
    this.state.gamma = gamma;
  }

  derivatives(state, t) {
    const { prey, predator } = state;
    const alpha = state.alpha || this.parameters.alpha;
    const beta = state.beta || this.parameters.beta;
    const delta = state.delta || this.parameters.delta;
    const gamma = state.gamma || this.parameters.gamma;
    const K = state.carryingCapacity || this.parameters.carryingCapacity;

    // logistic prey growth with carrying capacity
    const dPrey = alpha * prey * (1 - prey / K) - beta * prey * predator;
    const dPred = delta * prey * predator - gamma * predator;
    return { prey: dPrey, predator: dPred, carryingCapacity: 0 };
  }

  step(dt = 0.1) {
    const s = { ...this.state };
    const k1 = this.derivatives(s, s.time);

    const s2 = { ...s, prey: s.prey + 0.5 * dt * k1.prey, predator: s.predator + 0.5 * dt * k1.predator };
    const k2 = this.derivatives(s2, s.time + 0.5 * dt);

    const s3 = { ...s, prey: s.prey + 0.5 * dt * k2.prey, predator: s.predator + 0.5 * dt * k2.predator };
    const k3 = this.derivatives(s3, s.time + 0.5 * dt);

    const s4 = { ...s, prey: s.prey + dt * k3.prey, predator: s.predator + dt * k3.predator };
    const k4 = this.derivatives(s4, s.time + dt);

    const next = {
      prey: Math.max(0, s.prey + (dt / 6) * (k1.prey + 2 * k2.prey + 2 * k3.prey + k4.prey)),
      predator: Math.max(0, s.predator + (dt / 6) * (k1.predator + 2 * k2.predator + 2 * k3.predator + k4.predator)),
    };

    this.state.prey = next.prey;
    this.state.predator = next.predator;
    this.state.time += dt;
    this.emit('stepped', this, dt);
  }
}

/* ------------------------------------------------------------------ */
/* Spatial world grid                                                 */
/* ------------------------------------------------------------------ */

function zero(n) {
  return new Float64Array(n);
}

function idx(w, i, j) {
  return j * w + i;
}

function countNeighbors(grid, w, h, i, j) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = ((i + dx) % w + w) % w;
      const y = ((j + dy) % h + h) % h;
      n += grid[idx(w, x, y)];
    }
  }
  return n;
}

/**
 * World: spatial ecosystem on a 2D toroidal grid.
 *
 * Each cell holds resource (grass), prey (herbivore) and predator
 * densities. Each step:
 *   1. prey consumes resource, reproduces
 *   2. predators consume prey, reproduce, die
 *   3. resource regrows logistically
 *   4. all densities diffuse to neighbors
 *
 * state.temperature scales all metabolic rates (cross-domain hook).
 */
export class World extends Model {
  constructor({
    width = 64,
    height = 64,
    dt = 0.1,
    preyBirth = 0.08,
    preyDeath = 0.02,
    predBirth = 0.04,
    predDeath = 0.06,
    resourceRegrow = 0.1,
    resourceCapacity = 1.0,
    consumption = 0.05,
    predation = 0.02,
    diffusion = 0.1,
    temperature = 1.0,
    seed = null,
  } = {}) {
    super({
      id: 'world',
      name: 'Spatial ecosystem world',
      parameters: {
        width, height, dt, preyBirth, preyDeath, predBirth, predDeath,
        resourceRegrow, resourceCapacity, consumption, predation, diffusion, temperature,
      },
    });
    this.width = width;
    this.height = height;
    const size = width * height;
    this.dt = dt;
    this.preyBirth = preyBirth;
    this.preyDeath = preyDeath;
    this.predBirth = predBirth;
    this.predDeath = predDeath;
    this.resourceRegrow = resourceRegrow;
    this.resourceCapacity = resourceCapacity;
    this.consumption = consumption;
    this.predation = predation;
    this.diffusion = diffusion;
    this.temperature = temperature;

    this.state.resourceGrid = zero(size);
    this.state.preyGrid = zero(size);
    this.state.predatorGrid = zero(size);
    this.state.width = width;
    this.state.height = height;
    this.state.temperature = temperature;

    this._seed(seed);
  }

  _seed(seed) {
    const size = this.width * this.height;
    for (let i = 0; i < size; i++) {
      this.state.resourceGrid[i] = this.resourceCapacity;
      this.state.preyGrid[i] = 0;
      this.state.predatorGrid[i] = 0;
    }
    if (seed === 'random') {
      for (let i = 0; i < size; i++) {
        if (Math.random() < 0.1) this.state.preyGrid[i] = Math.random() * 0.5;
        if (Math.random() < 0.02) this.state.predatorGrid[i] = Math.random() * 0.3;
      }
    }
  }

  step(dt = this.dt) {
    const w = this.width;
    const h = this.height;
    const size = w * h;
    const temp = this.state.temperature;
    const res = this.state.resourceGrid;
    const prey = this.state.preyGrid;
    const pred = this.state.predatorGrid;

    const nextRes = new Float64Array(size);
    const nextPrey = new Float64Array(size);
    const nextPred = new Float64Array(size);

    const b = this.preyBirth * temp;
    const d = this.preyDeath * temp;
    const pb = this.predBirth * temp;
    const pd = this.predDeath * temp;
    const rg = this.resourceRegrow * temp;
    const c = this.consumption * temp;
    const p = this.predation * temp;

    // local interactions
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = idx(w, i, j);
        const r = res[k];
        const x = prey[k];
        const y = pred[k];

        const eatenResource = c * x * r;
        const eatenPrey = p * x * y;

        const newRes = Math.max(0, r - eatenResource + rg * (this.resourceCapacity - r) * dt);
        const newPrey = Math.max(0, x + b * x * (1 - x / 10) * dt - d * x * dt - eatenPrey + eatenResource * 0.1);
        const newPred = Math.max(0, y + pb * eatenPrey * dt - pd * y * dt);

        nextRes[k] = newRes;
        nextPrey[k] = newPrey;
        nextPred[k] = newPred;
      }
    }

    // diffusion (simple 5-point stencil, one pass)
    const diff = this.diffusion * temp * dt;
    if (diff > 0) {
      const blur = (grid) => {
        const out = new Float64Array(size);
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const k = idx(w, i, j);
            let center = grid[k];
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const x = ((i + dx) % w + w) % w;
                const y = ((j + dy) % h + h) % h;
                n += grid[idx(w, x, y)];
              }
            }
            out[k] = center * (1 - diff) + (diff / 8) * n;
          }
        }
        return out;
      };
      const bRes = blur(nextRes);
      const bPrey = blur(nextPrey);
      const bPred = blur(nextPred);
      for (let k = 0; k < size; k++) {
        nextRes[k] = bRes[k];
        nextPrey[k] = bPrey[k];
        nextPred[k] = bPred[k];
      }
    }

    this.state.resourceGrid = nextRes;
    this.state.preyGrid = nextPrey;
    this.state.predatorGrid = nextPred;
    this.state.temperature = temp;
    this.emit('stepped', this, dt);
  }

  totalPrey() {
    let s = 0;
    for (let i = 0; i < this.state.preyGrid.length; i++) s += this.state.preyGrid[i];
    return s;
  }

  totalPredator() {
    let s = 0;
    for (let i = 0; i < this.state.predatorGrid.length; i++) s += this.state.predatorGrid[i];
    return s;
  }

  totalResource() {
    let s = 0;
    for (let i = 0; i < this.state.resourceGrid.length; i++) s += this.state.resourceGrid[i];
    return s;
  }
}

export default { LotkaVolterra, World };

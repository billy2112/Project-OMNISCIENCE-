/**
 * Project OMNISCIENCE — Fluid dynamics domain.
 *
 * 2D incompressible Navier–Stokes on a fixed Eulerian grid using a simple
 * semi-Lagrangian advection + diffusion + pressure projection (Jacobi).
 *
 * State:
 *   state.u, state.v        : Float64Array velocity grids (w*h)
 *   state.density           : Float64Array passive scalar (e.g. dye/temperature)
 *   state.pressure          : Float64Array pressure field
 *   state.buoyancyFactor    : scalar converting density into vertical force
 *
 * Parameters: width, height, dx, dt, viscosity, diffusion, pressureIters
 *
 * Indexing: cell (i, j) -> index j * width + i, i = x (column), j = y (row).
 * Boundaries: no-slip (zero velocity at walls), zero-gradient density.
 */

import { Model } from '../core/index.js';

function zero(n) {
  return new Float64Array(n);
}

function copy(dst, src) {
  dst.set(src);
  return dst;
}

function idx(w, i, j) {
  return j * w + i;
}

/**
 * Linear solve (Jacobi) for the Poisson pressure equation.
 */
function linSolve(w, h, x, x0, a, c, iters) {
  const cRecip = 1 / c;
  for (let t = 0; t < iters; t++) {
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = idx(w, i, j);
        x[k] =
          (x0[k] +
            a * (x[idx(w, i - 1, j)] + x[idx(w, i + 1, j)] +
                 x[idx(w, i, j - 1)] + x[idx(w, i, j + 1)])) *
            cRecip;
      }
    }
    setBnd(w, h, x, 0);
  }
}

/**
 * No-slip boundary conditions for velocity, zero-gradient for scalars.
 */
function setBnd(w, h, x, b) {
  for (let i = 1; i < w - 1; i++) {
    x[idx(w, i, 0)] = b === 1 ? -x[idx(w, i, 1)] : x[idx(w, i, 1)];
    x[idx(w, i, h - 1)] = b === 1 ? -x[idx(w, i, h - 2)] : x[idx(w, i, h - 2)];
  }
  for (let j = 1; j < h - 1; j++) {
    x[idx(w, 0, j)] = b === 1 ? -x[idx(w, 1, j)] : x[idx(w, 1, j)];
    x[idx(w, w - 1, j)] = b === 1 ? -x[idx(w, w - 2, j)] : x[idx(w, w - 2, j)];
  }
  x[idx(w, 0, 0)] = x[idx(w, 1, 0)] = x[idx(w, 0, 1)] = 0;
  x[idx(w, w - 1, 0)] = x[idx(w, w - 2, 0)] = x[idx(w, w - 1, 1)] = 0;
  x[idx(w, 0, h - 1)] = x[idx(w, 1, h - 1)] = x[idx(w, 0, h - 2)] = 0;
  x[idx(w, w - 1, h - 1)] = x[idx(w, w - 2, h - 1)] = x[idx(w, w - 1, h - 2)] = 0;
}

function diffuse(w, h, b, x, x0, diff, dt) {
  const a = dt * diff * (w - 2) * (h - 2);
  linSolve(w, h, x, x0, a, 1 + 4 * a, 10);
  setBnd(w, h, x, b);
}

/**
 * Semi-Lagrangian advection of field d from previous field d0 by velocity (u,v).
 */
function advect(w, h, b, d, d0, u, v, dt) {
  const i0 = (w - 2) / 1; // unused guard
  const dt0 = dt * (w - 2);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = idx(w, i, j);
      let x = i - dt0 * u[k];
      let y = j - dt0 * v[k];
      if (x < 0.5) x = 0.5;
      if (x > w - 1.5) x = w - 1.5;
      if (y < 0.5) y = 0.5;
      if (y > h - 1.5) y = h - 1.5;
      const i0 = Math.floor(x);
      const i1 = i0 + 1;
      const j0 = Math.floor(y);
      const j1 = j0 + 1;
      const s1 = x - i0;
      const s0 = 1 - s1;
      const t1 = y - j0;
      const t0 = 1 - t1;
      d[k] =
        s0 * (t0 * d0[idx(w, i0, j0)] + t1 * d0[idx(w, i0, j1)]) +
        s1 * (t0 * d0[idx(w, i1, j0)] + t1 * d0[idx(w, i1, j1)]);
    }
  }
  setBnd(w, h, d, b);
}

function project(w, h, u, v, p, div, iters) {
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = idx(w, i, j);
      div[k] =
        -0.5 * (u[idx(w, i + 1, j)] - u[idx(w, i - 1, j)] +
                v[idx(w, i, j + 1)] - v[idx(w, i, j - 1)]);
      p[k] = 0;
    }
  }
  setBnd(w, h, div, 0);
  setBnd(w, h, p, 0);
  linSolve(w, h, p, div, 1, 4, iters);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = idx(w, i, j);
      u[k] -= 0.5 * (p[idx(w, i + 1, j)] - p[idx(w, i - 1, j)]);
      v[k] -= 0.5 * (p[idx(w, i, j + 1)] - p[idx(w, i, j - 1)]);
    }
  }
  setBnd(w, h, u, 1);
  setBnd(w, h, v, 1);
}

/**
 * Add a density source at (i, j).
 */
function addSource(w, h, x, s, dt) {
  const n = w * h;
  for (let k = 0; k < n; k++) {
    x[k] += dt * s[k];
  }
}

export function cellGrid({ width = 32, height = 32, dx = 1 } = {}) {
  return { width, height, dx, size: width * height };
}

export class NavierStokes extends Model {
  constructor({
    width = 32,
    height = 32,
    dx = 1.0,
    dt = 0.1,
    viscosity = 0.0001,
    diffusion = 0.0001,
    pressureIters = 10,
    buoyancyFactor = 0.1,
    gravity = 0.0,
  } = {}) {
    super({
      id: 'navierstokes',
      name: '2D Navier–Stokes',
      parameters: { width, height, dx, dt, viscosity, diffusion, pressureIters, buoyancyFactor, gravity },
    });
    this.width = width;
    this.height = height;
    this.dx = dx;
    this.dt = dt;
    this.viscosity = viscosity;
    this.diffusion = diffusion;
    this.pressureIters = pressureIters;
    this.buoyancyFactor = buoyancyFactor;
    this.gravity = gravity;
    const size = width * height;
    this.state.u = zero(size);
    this.state.v = zero(size);
    this.state.uPrev = zero(size);
    this.state.vPrev = zero(size);
    this.state.density = zero(size);
    this.state.densityPrev = zero(size);
    this.state.pressure = zero(size);
    this.state.buoyancyFactor = buoyancyFactor;
  }

  initialize() {
    copy(this.state.uPrev, this.state.u);
    copy(this.state.vPrev, this.state.v);
    copy(this.state.densityPrev, this.state.density);
    super.initialize();
  }

  step(dt = this.dt) {
    const w = this.width;
    const h = this.height;
    const u = this.state.u;
    const v = this.state.v;
    const uPrev = this.state.uPrev;
    const vPrev = this.state.vPrev;
    const dens = this.state.density;
    const densPrev = this.state.densityPrev;

    // 1. diffuse velocity
    diffuse(w, h, 1, uPrev, u, this.viscosity, dt);
    diffuse(w, h, 2, vPrev, v, this.viscosity, dt);

    // 2. project (enforce incompressibility)
    project(w, h, uPrev, vPrev, this.state.pressure, this.state.div || zero(w * h), this.pressureIters);

    // 3. advect velocity
    copy(u, uPrev);
    copy(v, vPrev);
    advect(w, h, 1, u, uPrev, uPrev, vPrev, dt);
    advect(w, h, 2, v, vPrev, uPrev, vPrev, dt);

    // 4. re-project
    project(w, h, u, v, this.state.pressure, this.state.div || zero(w * h), this.pressureIters);

    // 5. buoyancy: density -> vertical force (cross-domain injection point)
    const buoy = this.state.buoyancyFactor || 0;
    const grav = this.gravity || 0;
    if (buoy || grav) {
      for (let j = 1; j < h - 1; j++) {
        for (let i = 1; i < w - 1; i++) {
          const k = idx(w, i, j);
          v[k] += dt * (dens[k] * buoy + grav);
        }
      }
      setBnd(w, h, v, 1);
    }

    // 6. diffuse + advect density
    diffuse(w, h, 0, densPrev, dens, this.diffusion, dt);
    copy(dens, densPrev);
    advect(w, h, 0, dens, densPrev, u, v, dt);

    this.state.buoyancyFactor = buoy;
    this.emit('stepped', this, dt);
  }

  /**
   * Inject density at grid cell (i, j).
   */
  addDensity(i, j, amount) {
    if (i < 0 || i >= this.width || j < 0 || j >= this.height) return;
    this.state.density[idx(this.width, i, j)] += amount;
  }

  /**
   * Inject velocity at grid cell (i, j).
   */
  addVelocity(i, j, ux, uy) {
    if (i < 0 || i >= this.width || j < 0 || j >= this.height) return;
    const k = idx(this.width, i, j);
    this.state.u[k] += ux;
    this.state.v[k] += uy;
  }

  getGrid() {
    const { width, height } = this;
    const u = Array.from(this.state.u);
    const v = Array.from(this.state.v);
    const dens = Array.from(this.state.density);
    const grid = [];
    for (let j = 0; j < height; j++) {
      const row = [];
      for (let i = 0; i < width; i++) {
        const k = idx(width, i, j);
        row.push({ i, j, u: u[k], v: v[k], density: dens[k] });
      }
      grid.push(row);
    }
    return grid;
  }
}

export default NavierStokes;

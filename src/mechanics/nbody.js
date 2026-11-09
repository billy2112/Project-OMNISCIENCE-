/**
 * Project OMNISCIENCE — Classical mechanics domain.
 *
 * N-body gravitational simulation with symplectic leapfrog (kick-drift-kick)
 * integration. Bodies carry mass, position, velocity; the integrator updates
 * positions and velocities under mutual Newtonian gravity.
 *
 * State exposed per body index i:
 *   state.positions  : Float64Array [x0,y0,z0, x1,y1,z1, ...]
 *   state.velocities : Float64Array [...]
 *   state.masses     : Float64Array [...]
 *   state.accelerations : Float64Array [...] (last computed accelerations)
 *
 * Coupling hook: state.thermalDamping (default 0) scales velocity each step,
 * allowing other domains (e.g. chemistry temperature) to inject drag.
 */

import { Model } from '../core/index.js';

export const G = 1.0; // gravitational constant (simulation units)
const EPS2 = 1e-4; // softening squared to avoid singularities

function clamp(v, min, max) {
  return Math.min(max, Math.min(min, v));
}

/**
 * Single body descriptor accepted by NBody constructor.
 */
export function body({
  id = '',
  mass = 1,
  position = [0, 0, 0],
  velocity = [0, 0, 0],
} = {}) {
  return { id, mass, position: [...position], velocity: [...velocity] };
}

/**
 * N-body gravitational model.
 */
export class NBody extends Model {
  constructor({ bodies = [], softening = EPS2, damping = 0 } = {}) {
    super({ id: 'nbody', name: 'N-body gravity', parameters: { G, softening, damping } });
    this.bodies = bodies.map((b) => body(b));
    this.softening = softening;
    this.damping = damping;
    this._n = this.bodies.length;
    this._rebuildState();
  }

  initialize() {
    this._rebuildState();
    this._computeAccelerations();
    super.initialize();
  }

  _rebuildState() {
    const n = this.bodies.length;
    this._n = n;
    this.state.positions = new Float64Array(n * 3);
    this.state.velocities = new Float64Array(n * 3);
    this.state.masses = new Float64Array(n);
    this.state.accelerations = new Float64Array(n * 3);
    this.state.thermalDamping = this.damping;
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      this.state.positions[3 * i] = b.position[0];
      this.state.positions[3 * i + 1] = b.position[1];
      this.state.positions[3 * i + 2] = b.position[2];
      this.state.velocities[3 * i] = b.velocity[0];
      this.state.velocities[3 * i + 1] = b.velocity[1];
      this.state.velocities[3 * i + 2] = b.velocity[2];
      this.state.masses[i] = b.mass;
    }
    this.state.kineticEnergy = 0;
  }

  _computeAccelerations() {
    const n = this._n;
    const pos = this.state.positions;
    const mass = this.state.masses;
    const acc = this.state.accelerations;
    const G = this.parameters.G;
    const eps2 = this.softening;
    for (let i = 0; i < n * 3; i++) acc[i] = 0;
    for (let i = 0; i < n; i++) {
      let ax = 0, ay = 0, az = 0;
      const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = pos[3 * j] - xi;
        const dy = pos[3 * j + 1] - yi;
        const dz = pos[3 * j + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const r3inv = 1 / Math.sqrt(r2 * r2 * r2);
        const f = G * mass[j] * r3inv;
        ax += dx * f;
        ay += dy * f;
        az += dz * f;
      }
      acc[3 * i] = ax;
      acc[3 * i + 1] = ay;
      acc[3 * i + 2] = az;
    }
  }

  /**
   * Symplectic leapfrog (kick-drift-kick):
   *   v += 0.5 * a * dt      (half kick)
   *   x += v * dt            (drift)
   *   recompute a
   *   v += 0.5 * a * dt      (half kick)
   *   apply thermal damping if set
   */
  step(dt) {
    const n = this._n;
    const pos = this.state.positions;
    const vel = this.state.velocities;
    const acc = this.state.accelerations;
    const damping = this.state.thermalDamping || 0;

    // half kick
    for (let i = 0; i < n * 3; i++) {
      vel[i] += 0.5 * acc[i] * dt;
    }
    // drift
    for (let i = 0; i < n * 3; i++) {
      pos[i] += vel[i] * dt;
    }
    // recompute accelerations at new positions
    this._computeAccelerations();
    // second half kick
    for (let i = 0; i < n * 3; i++) {
      vel[i] += 0.5 * this.state.accelerations[i] * dt;
    }
    // optional thermal damping (coupling injection point)
    if (damping) {
      const factor = 1 - damping * dt;
      for (let i = 0; i < n * 3; i++) {
        vel[i] *= factor;
      }
    }

    // mirror back to body objects for convenience
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      b.position[0] = pos[3 * i];
      b.position[1] = pos[3 * i + 1];
      b.position[2] = pos[3 * i + 2];
      b.velocity[0] = vel[3 * i];
      b.velocity[1] = vel[3 * i + 1];
      b.velocity[2] = vel[3 * i + 2];
    }

    this.state.kineticEnergy = this.kineticEnergy();

    this.emit('stepped', this, dt);
  }

  /**
   * Total kinetic energy of the system.
   */
  kineticEnergy() {
    let E = 0;
    const vel = this.state.velocities;
    const mass = this.state.masses;
    const n = this._n;
    for (let i = 0; i < n; i++) {
      const vx = vel[3 * i], vy = vel[3 * i + 1], vz = vel[3 * i + 2];
      E += 0.5 * mass[i] * (vx * vx + vy * vy + vz * vz);
    }
    return E;
  }

  /**
   * Total gravitational potential energy.
   */
  potentialEnergy() {
    let E = 0;
    const pos = this.state.positions;
    const mass = this.state.masses;
    const n = this._n;
    const G = this.parameters.G;
    const eps2 = this.softening;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[3 * j] - pos[3 * i];
        const dy = pos[3 * j + 1] - pos[3 * i + 1];
        const dz = pos[3 * j + 2] - pos[3 * i + 2];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
        E -= G * mass[i] * mass[j] / r;
      }
    }
    return E;
  }

  get bodiesSnapshot() {
    return this.bodies.map((b) => ({
      id: b.id,
      mass: b.mass,
      position: [...b.position],
      velocity: [...b.velocity],
    }));
  }
}

export default NBody;

/**
 * Project OMNISCIENCE — Chemical reaction system domain.
 *
 * Chemical kinetics based on mass-action kinetics. A reaction network is a
 * set of reactions; each reaction has reactants, products and a rate
 * constant. Concentrations evolve via dC/dt = sum(rate * stoich).
 *
 * Integrated with classical RK4.
 *
 * State:
 *   state.concentrations : Map<species, concentration>
 *   state.temperature    : scalar (cross-domain injection point; default 300 K)
 *   state.rates          : Map<reactionId, instantaneous rate>
 *
 * Coupling hook: state.temperature scales rates via an Arrhenius factor,
 * so a fluid/thermal model can drive reaction speeds.
 */

import { Model } from '../core/index.js';

export const R = 8.314; // J/(mol·K)

/**
 * Reaction descriptor:
 *   { id, reactants: {A: 1}, products: {B: 2}, rate: k, Ea?: activation energy }
 */
export function reaction(desc) {
  return {
    id: desc.id,
    reactants: { ...(desc.reactants || {}) },
    products: { ...(desc.products || {}) },
    rate: desc.rate,
    Ea: desc.Ea,
  };
}

/**
 * Compute instantaneous rates for all reactions at given concentrations and
 * temperature (with optional Arrhenius temperature scaling).
 */
function reactionRates(reactions, concentrations, temperature = 300) {
  const rates = new Map();
  for (const rxn of reactions) {
    let rate = rxn.rate;
    if (rxn.Ea) {
      const arrhenius = Math.exp((-rxn.Ea / R) * (1 / temperature - 1 / 300));
      rate = rate * arrhenius;
    }
    for (const [species, stoich] of Object.entries(rxn.reactants)) {
      const c = concentrations[species] || 0;
      rate *= Math.pow(Math.max(c, 0), stoich);
    }
    rates.set(rxn.id, rate);
  }
  return rates;
}

/**
 * Time derivative of concentrations given current rates.
 */
function concentrationDerivatives(reactions, rates) {
  const d = {};
  for (const rxn of reactions) {
    const r = rates.get(rxn.id) || 0;
    for (const [species, stoich] of Object.entries(rxn.reactants)) {
      d[species] = (d[species] || 0) - r * stoich;
    }
    for (const [species, stoich] of Object.entries(rxn.products)) {
      d[species] = (d[species] || 0) + r * stoich;
    }
  }
  return d;
}

export class Chemistry extends Model {
  constructor({
    species = [],
    reactions = [],
    temperature = 300,
    useArrhenius = true,
  } = {}) {
    super({
      id: 'chemistry',
      name: 'Chemical kinetics',
      parameters: { temperature, useArrhenius },
    });
    this.species = [...species];
    this.reactions = reactions.map((r) => reaction(r));
    this.temperature = temperature;
    this.useArrhenius = useArrhenius;
    this.state.concentrations = {};
    for (const s of species) this.state.concentrations[s] = 0;
    this.state.temperature = temperature;
    this.state.rates = new Map();
  }

  initialize() {
    this.state.temperature = this.temperature;
    super.initialize();
  }

  /**
   * Derivatives dC/dt for ODE integration.
   */
  derivatives(state, t) {
    const conc = { ...state.concentrations };
    const rates = reactionRates(
      this.reactions,
      conc,
      this.useArrhenius ? state.temperature : 300
    );
    this.state.rates = rates;
    return { concentrations: concentrationDerivatives(this.reactions, rates) };
  }

  step(dt = 0.01) {
    const conc = { ...this.state.concentrations };
    const temp = this.state.temperature;

    const k1 = concentrationDerivatives(
      this.reactions,
      reactionRates(this.reactions, conc, temp)
    );
    const c2 = {};
    const c3 = {};
    const c4 = {};

    for (const s of this.species) {
      c2[s] = conc[s] + 0.5 * dt * (k1[s] || 0);
      c3[s] = conc[s] + 0.5 * dt * (k1[s] || 0); // k2 uses k1 midpoint approximation
    }
    const k2 = concentrationDerivatives(
      this.reactions,
      reactionRates(this.reactions, c2, temp)
    );
    for (const s of this.species) {
      c3[s] = conc[s] + 0.5 * dt * (k2[s] || 0);
      c4[s] = conc[s] + dt * (k2[s] || 0);
    }
    const k3 = concentrationDerivatives(
      this.reactions,
      reactionRates(this.reactions, c3, temp)
    );
    const k4 = concentrationDerivatives(
      this.reactions,
      reactionRates(this.reactions, c4, temp)
    );

    const next = {};
    for (const s of this.species) {
      next[s] = Math.max(
        0,
        conc[s] + (dt / 6) * ((k1[s] || 0) + 2 * (k2[s] || 0) + 2 * (k3[s] || 0) + (k4[s] || 0))
      );
    }

    this.state.concentrations = next;
    this.state.rates = reactionRates(this.reactions, next, temp);
    this.emit('stepped', this, dt);
  }

  setConcentration(species, value) {
    this.state.concentrations[species] = Math.max(0, value);
    return this;
  }

  getConcentration(species) {
    return this.state.concentrations[species] || 0;
  }

  getRate(reactionId) {
    return this.state.rates.get(reactionId) || 0;
  }
}

export default Chemistry;

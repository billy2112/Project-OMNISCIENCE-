/**
 * Project OMNISCIENCE — Coupling utilities.
 *
 * Re-exports the core Coupler and adds:
 *   VariableMapper  — declarative, bidirectional variable mapping between models
 *   chain           — build a sequence of couplers
 */

import { Coupler } from '../core/index.js';

/**
 * VariableMapper builds Coupler links from a declarative spec:
 *
 *   const mapper = new VariableMapper();
 *   mapper.map('chemistry', 'temperature', 'mechanics', 'thermalDamping', v => v * 0.01);
 *   mapper.map('mechanics', 'kineticEnergy', 'fluids', 'forcing', v => v * 0.001);
 *   const coupler = mapper.build();
 *   simulator.addCoupler(coupler);
 */
export class VariableMapper {
  constructor() {
    this._links = [];
  }

  map(sourceModel, sourceVar, targetModel, targetVar, transform = (v) => v) {
    this._links.push({ sourceModel, sourceVar, targetModel, targetVar, transform });
    return this;
  }

  build() {
    const coupler = new Coupler();
    for (const link of this._links) {
      coupler.connect(link.sourceModel, link.sourceVar, link.targetModel, link.targetVar, link.transform);
    }
    return coupler;
  }
}

/**
 * Chain several models together with adjacent couplers:
 *   chain([m1, m2, m3], [
 *     { from: 'm1', fromVar: 'out', to: 'm2', toVar: 'in' },
 *     { from: 'm2', fromVar: 'out', to: 'm3', toVar: 'in' }
 * ])
 * Models here must be retrievable by name from the simulator; the returned
 * object holds the coupler and an `install(simulator)` method.
 */
export function chain(models, links, transforms = {}) {
  const coupler = new Coupler();
  for (const link of links) {
    const fromModel = models.find((m) => m.id === link.from || m.name === link.from);
    const toModel = models.find((m) => m.id === link.to || m.name === link.to);
    if (!fromModel || !toModel) {
      throw new Error(`Coupling.chain: model not found for link ${JSON.stringify(link)}`);
    }
    const transform = transforms[link.fromVar] || ((v) => v);
    coupler.connect(fromModel, link.fromVar, toModel, link.toVar, transform);
  }
  return {
    coupler,
    install(simulator) {
      simulator.addCoupler(coupler);
      return this;
    },
  };
}

export { Coupler };
export default { VariableMapper, chain, Coupler };

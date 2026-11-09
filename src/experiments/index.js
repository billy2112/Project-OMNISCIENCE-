/**
 * Project OMNISCIENCE — Experiments framework.
 *
 * Experiment   — runs a simulation with a named configuration and records
 *                the final state plus history slices.
 * ParameterSweep — runs many experiments over a grid of parameter values,
 *                  collecting a metrics function from each run.
 *
 * Metrics: function(simulator) -> number|object summarizing a run.
 */

export class Experiment {
  constructor({ name, buildSimulator, duration, metrics, dt = 0.01 } = {}) {
    this.name = name || 'experiment';
    this.buildSimulator = buildSimulator;
    this.duration = duration;
    this.metrics = metrics || ((sim) => sim.getState());
    this.dt = dt;
    this.result = null;
  }

  run(params = {}) {
    const sim = this.buildSimulator(params, this.dt);
    sim.run(this.duration);
    const m = typeof this.metrics === 'function' ? this.metrics(sim) : this.metrics;
    const result = { name: this.name, params, duration: this.duration, metrics: m, simulator: sim };
    this.result = result;
    return result;
  }

  runSteps(n, params = {}) {
    const sim = this.buildSimulator(params, this.dt);
    sim.runSteps(n);
    const m = typeof this.metrics === 'function' ? this.metrics(sim) : this.metrics;
    const result = { name: this.name, params, steps: n, metrics: m, simulator: sim };
    this.result = result;
    return result;
  }
}

/**
 * Cartesian product of parameter options.
 */
function cartesian(options) {
  const keys = Object.keys(options);
  if (keys.length === 0) return [{}];
  const rest = cartesian(Object.fromEntries(keys.slice(1).map((k) => [k, options[k]])));
  const out = [];
  for (const value of options[keys[0]]) {
    for (const r of rest) {
      out.push({ [keys[0]]: value, ...r });
    }
  }
  return out;
}

export class ParameterSweep {
  constructor({ name, experiment, options, metrics } = {}) {
    this.name = name || 'sweep';
    this.experiment = experiment;
    this.options = options || {};
    this.metrics = metrics;
    this.runs = [];
  }

  run() {
    const combos = cartesian(this.options);
    this.runs = [];
    for (const params of combos) {
      const exp = this.metrics
        ? new Experiment({
            name: `${this.experiment.name || 'exp'}`,
            buildSimulator: this.experiment.buildSimulator,
            duration: this.experiment.duration,
            metrics: this.metrics,
            dt: this.experiment.dt,
          })
        : this.experiment;
      const result = exp.run(params);
      this.runs.push({ params, result });
    }
    return this.runs;
  }

  bestBy(metricKey, maximize = true) {
    if (!this.runs.length) return null;
    let best = this.runs[0];
    for (const run of this.runs) {
      const v = run.result.metrics[metricKey];
      const bv = best.result.metrics[metricKey];
      if (v == null) continue;
      if (maximize ? v > bv : v < bv) best = run;
    }
    return best;
  }

  toTable(metricKeys) {
    const header = [...Object.keys(this.options), ...(metricKeys || [])];
    const rows = this.runs.map((run) => {
      const row = [...Object.values(run.params)];
      if (metricKeys) {
        for (const k of metricKeys) row.push(run.result.metrics[k]);
      }
      return row;
    });
    return { header, rows };
  }
}

export default { Experiment, ParameterSweep };

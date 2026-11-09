/**
 * Project OMNISCIENCE — Core simulation engine.
 *
 * The core provides the common abstractions that every scientific model
 * plugs into:
 *
 *   Model      — a scientific system with state, parameters and a step rule
 *   Simulator  — advances one or more coupled models through time
 *   Coupler    — connects variables between models (cross-domain coupling)
 *   Registry   — named catalog of models for experiment composition
 *   EventEmitter — lightweight event bus for hooks (step, start, end, error)
 */

export class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(listener);
    return this;
  }

  off(event, listener) {
    const set = this._listeners.get(event);
    if (set) set.delete(listener);
    return this;
  }

  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(...args);
      } catch (err) {
        // A listener must not kill the simulation; report and continue.
        if (typeof process !== 'undefined' && process.emitWarning) {
          process.emitWarning(err, 'SimulationListenerWarning');
        }
      }
    }
  }
}

/**
 * Base class for every scientific model in OMNISCIENCE.
 *
 * A model owns:
 *   - id          : stable string identifier
 *   - name        : human-readable name
 *   - parameters  : static configuration (read-only after initialize)
 *   - state       : mutable state exposed for stepping and coupling
 *   - time        : simulation time local to this model
 *
 * Subclasses implement `initialize()` and `step(dt)`. They may also expose
 * `derivatives(state, t)` for ODE-style integration and `getVariable` /
 * `setVariable` are provided by the base for coupling.
 */
export class Model extends EventEmitter {
  constructor({ id, name, parameters = {} } = {}) {
    super();
    this.id = id || this.constructor.name;
    this.name = name || this.id;
    this.parameters = { ...parameters };
    this.state = {};
    this.time = 0;
    this._initialized = false;
  }

  initialize() {
    this._initialized = true;
    this.emit('initialize', this);
    return this;
  }

  /**
   * Advance the model by one time step of length `dt`.
   * Must be implemented by subclasses.
   */
  step(dt) {
    throw new Error(`${this.constructor.name}: step(dt) not implemented`);
  }

  /**
   * Derivative of the state vector at (state, t). Optional; used by ODE
   * integrators. Returns an object mirroring the state keys.
   */
  derivatives(state, t) {
    return {};
  }

  /**
   * Read a named state variable (used by couplers).
   */
  getVariable(name) {
    return this.state[name];
  }

  /**
   * Write a named state variable (used by couplers).
   */
  setVariable(name, value) {
    this.state[name] = value;
    return this;
  }

  getState() {
    return { ...this.state };
  }

  setState(state) {
    this.state = { ...state };
    return this;
  }

  reset() {
    this.time = 0;
    this.state = {};
    this._initialized = false;
    this.emit('reset', this);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      parameters: this.parameters,
      state: this.state,
      time: this.time,
    };
  }
}

/**
 * Advances registered models through shared simulation time.
 *
 * The simulator owns the global clock. Every registered model is stepped
 * once per simulator step in registration order. Couplers run between
 * models after each step so cross-domain effects are applied before the
 * next step begins.
 *
 * History snapshots are recorded when `recordHistory` is true.
 */
export class Simulator extends EventEmitter {
  constructor({ dt = 0.01, recordHistory = true, maxHistory = 10000 } = {}) {
    super();
    this.dt = dt;
    this.recordHistory = recordHistory;
    this.maxHistory = maxHistory;
    this.time = 0;
    this.stepCount = 0;
    this.models = [];
    this.couplers = [];
    this.history = [];
    this._running = false;
  }

  addModel(model) {
    if (!(model instanceof Model)) {
      throw new Error('Simulator.addModel: expected a Model instance');
    }
    if (!model._initialized) model.initialize();
    this.models.push(model);
    this.emit('modelAdded', model);
    return this;
  }

  removeModel(model) {
    const idx = this.models.indexOf(model);
    if (idx !== -1) this.models.splice(idx, 1);
    this.emit('modelRemoved', model);
    return this;
  }

  addCoupler(coupler) {
    if (!(coupler instanceof Coupler)) {
      throw new Error('Simulator.addCoupler: expected a Coupler instance');
    }
    this.couplers.push(coupler);
    coupler.bindTo(this);
    this.emit('couplerAdded', coupler);
    return this;
  }

  /**
   * Run the simulation for `duration` time units.
   * Resolves when finished; rejects on model error.
   */
  run(duration) {
    if (this._running) throw new Error('Simulator: already running');
    this._running = true;
    const steps = Math.ceil(duration / this.dt);
    try {
      this.emit('start', this);
      for (let i = 0; i < steps; i++) {
        this.step();
      }
      this.emit('end', this);
    } finally {
      this._running = false;
    }
    return this;
  }

  runSteps(n) {
    if (this._running) throw new Error('Simulator: already running');
    this._running = true;
    try {
      this.emit('start', this);
      for (let i = 0; i < n; i++) {
        this.step();
      }
      this.emit('end', this);
    } finally {
      this._running = false;
    }
    return this;
  }

  /**
   * Single simulator step: step all models, then apply couplers.
   */
  step() {
    this.emit('preStep', this);
    for (const model of this.models) {
      model.step(this.dt);
      model.time += this.dt;
      model.emit('stepped', model, this.dt);
    }
    for (const coupler of this.couplers) {
      coupler.apply();
    }
    this.time += this.dt;
    this.stepCount += 1;
    this.emit('postStep', this);

    if (this.recordHistory) {
      this._recordSnapshot();
    }
    return this;
  }

  _recordSnapshot() {
    const snapshot = { t: this.time, step: this.stepCount, models: {} };
    for (const model of this.models) {
      snapshot.models[model.id] = model.getState();
    }
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getState() {
    return {
      time: this.time,
      stepCount: this.stepCount,
      dt: this.dt,
      models: this.models.map((m) => ({ id: m.id, state: m.getState() })),
    };
  }

  reset() {
    this.time = 0;
    this.stepCount = 0;
    this.history = [];
    for (const model of this.models) model.reset();
    for (const coupler of this.couplers) coupler.reset();
    this.emit('reset', this);
    return this;
  }
}

/**
 * Declares a directional coupling from a source model/variable to a target
 * model/variable, optionally transforming the value with `transform`.
 *
 * Example:
 *   const coupler = new Coupler();
 *   coupler.connect(chemistry, 'temperature', mechanics, 'thermalDamping', t => t * 0.01);
 *
 * The coupler binds to a Simulator so it is applied after each model step.
 */
export class Coupler extends EventEmitter {
  constructor() {
    super();
    this._links = [];
    this._simulator = null;
  }

  bindTo(simulator) {
    this._simulator = simulator;
    return this;
  }

  /**
   * Create a link: sourceModel[sourceVar] --transform--> targetModel[targetVar].
   * `transform` receives the source value and returns the value to assign.
   */
  connect(sourceModel, sourceVar, targetModel, targetVar, transform = (v) => v) {
    this._links.push({
      sourceModel,
      sourceVar,
      targetModel,
      targetVar,
      transform,
    });
    this.emit('linkAdded', this._links[this._links.length - 1]);
    return this;
  }

  apply() {
    for (const link of this._links) {
      const sourceValue = link.sourceModel.getVariable(link.sourceVar);
      const targetValue = link.transform(sourceValue, link.sourceModel, link.targetModel);
      link.targetModel.setVariable(link.targetVar, targetValue);
    }
    this.emit('applied', this);
    return this;
  }

  reset() {
    this.emit('reset', this);
    return this;
  }

  get links() {
    return [...this._links];
  }
}

/**
 * Named catalog of models. Used to compose experiments from reusable,
 * parameterized model templates.
 */
export class Registry extends EventEmitter {
  constructor() {
    super();
    this._factories = new Map();
    this._instances = new Map();
  }

  /**
   * Register a factory function that builds a Model from a params object.
   */
  register(name, factory) {
    this._factories.set(name, factory);
    this.emit('registered', name, factory);
    return this;
  }

  /**
   * Build (or rebuild) a named model instance with the given parameters.
   */
  build(name, params = {}, id) {
    const factory = this._factories.get(name);
    if (!factory) throw new Error(`Registry: no factory registered for "${name}"`);
    const model = factory(params);
    if (id) model.id = id;
    this._instances.set(model.id, model);
    this.emit('built', model);
    return model;
  }

  get(id) {
    return this._instances.get(id);
  }

  names() {
    return [...this._factories.keys()];
  }

  clear() {
    this._instances.clear();
    this.emit('cleared', this);
    return this;
  }
}



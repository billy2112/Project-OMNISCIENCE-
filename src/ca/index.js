/**
 * Project OMNISCIENCE — Cellular automata domain.
 *
 * Two CA models:
 *   ElementaryCA — 1D binary CA evolving by a Wolfram rule number.
 *   GameOfLife   — 2D Conway's Game of Life.
 *
 * State:
 *   state.cells       : Uint8Array of cell states (0/1)
 *   state.width, state.height : grid dimensions
 *   state.rule        : rule number (ElementaryCA only)
 *   state.generation  : step counter
 *   state.density     : fraction of live cells (cross-domain read hook)
 */

import { Model } from '../core/index.js';

/* ------------------------------------------------------------------ */
/* Elementary CA (1D)                                                 */
/* ------------------------------------------------------------------ */

/**
 * ElementaryCA: 1D binary cellular automaton.
 *
 * Rule number (0–255) maps each 3-cell neighborhood pattern (111..000) to
 * an output bit. Boundaries wrap (ring).
 */
export class ElementaryCA extends Model {
  constructor({ width = 128, rule = 30, seed = null } = {}) {
    super({
      id: 'elementaryca',
      name: 'Elementary cellular automaton',
      parameters: { width, rule },
    });
    this.width = width;
    this.rule = rule & 0xff;
    this.state.cells = new Uint8Array(width);
    this.state.width = width;
    this.state.rule = this.rule;
    this.state.generation = 0;
    this.state.density = 0;
    this._seed(seed);
  }

  _seed(seed) {
    const cells = this.state.cells;
    for (let i = 0; i < this.width; i++) cells[i] = 0;
    if (seed === 'random') {
      for (let i = 0; i < this.width; i++) cells[i] = Math.random() < 0.5 ? 1 : 0;
    } else if (Array.isArray(seed)) {
      const offset = Math.floor((this.width - seed.length) / 2);
      for (let i = 0; i < seed.length; i++) cells[offset + i] = seed[i] ? 1 : 0;
    } else if (seed === 'center' || seed === null) {
      cells[Math.floor(this.width / 2)] = 1;
    }
    this._updateDensity();
  }

  step(dt = 1) {
    const width = this.width;
    const cells = this.state.cells;
    const next = new Uint8Array(width);
    const rule = this.rule;

    for (let i = 0; i < width; i++) {
      const l = cells[(i - 1 + width) % width];
      const c = cells[i];
      const r = cells[(i + 1) % width];
      const pattern = (l << 2) | (c << 1) | r; // 111=7 ... 000=0
      next[i] = (rule >> pattern) & 1;
    }

    this.state.cells = next;
    this.state.generation += 1;
    this._updateDensity();
    this.emit('stepped', this, dt);
  }

  _updateDensity() {
    let sum = 0;
    for (let i = 0; i < this.width; i++) sum += this.state.cells[i];
    this.state.density = sum / this.width;
  }

  setCell(i, value) {
    this.state.cells[i] = value ? 1 : 0;
    return this;
  }

  getRow() {
    return Array.from(this.state.cells);
  }
}

/* ------------------------------------------------------------------ */
/* Game of Life (2D)                                                  */
/* ------------------------------------------------------------------ */

/**
 * GameOfLife: Conway's Game of Life on a 2D toroidal grid.
 *
 * Rules:
 *   - live cell with 2 or 3 neighbors survives
 *   - dead cell with exactly 3 neighbors becomes alive
 */
export class GameOfLife extends Model {
  constructor({ width = 64, height = 64, seed = null } = {}) {
    super({
      id: 'gameoflife',
      name: "Conway's Game of Life",
      parameters: { width, height },
    });
    this.width = width;
    this.height = height;
    const size = width * height;
    this.state.cells = new Uint8Array(size);
    this.state.next = new Uint8Array(size);
    this.state.width = width;
    this.state.height = height;
    this.state.generation = 0;
    this.state.density = 0;
    this._seed(seed);
  }

  idx(x, y) {
    return ((y % this.height) + this.height) % this.height * this.width +
      ((x % this.width) + this.width) % this.width;
  }

  _seed(seed) {
    const cells = this.state.cells;
    for (let i = 0; i < cells.length; i++) cells[i] = 0;
    if (seed === 'random') {
      for (let i = 0; i < cells.length; i++) cells[i] = Math.random() < 0.3 ? 1 : 0;
    } else if (Array.isArray(seed)) {
      // seed: array of [x, y] live coordinates
      const w = this.width;
      const h = this.height;
      const ox = Math.floor((w - 20) / 2);
      const oy = Math.floor((h - 20) / 2);
      for (const [x, y] of seed) {
        this.setCell(ox + x, oy + y, 1);
      }
    } else if (seed === 'glider' || seed === null) {
      // glider pattern
      this.setCell(1, 0, 1);
      this.setCell(2, 1, 1);
      this.setCell(0, 2, 1);
      this.setCell(1, 2, 1);
      this.setCell(2, 2, 1);
    }
    this._updateDensity();
  }

  setCell(x, y, value) {
    this.state.cells[this.idx(x, y)] = value ? 1 : 0;
    return this;
  }

  getCell(x, y) {
    return this.state.cells[this.idx(x, y)];
  }

  step(dt = 1) {
    const w = this.width;
    const h = this.height;
    const cells = this.state.cells;
    const next = this.state.next;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = this.idx(x, y);
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            n += cells[this.idx(x + dx, y + dy)];
          }
        }
        const alive = cells[k] === 1;
        next[k] = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
      }
    }

    this.state.cells = next;
    this.state.next = cells; // swap buffers for reuse
    this.state.generation += 1;
    this._updateDensity();
    this.emit('stepped', this, dt);
  }

  _updateDensity() {
    let sum = 0;
    const cells = this.state.cells;
    for (let i = 0; i < cells.length; i++) sum += cells[i];
    this.state.density = sum / cells.length;
  }

  getGrid() {
    const w = this.width;
    const h = this.height;
    const cells = this.state.cells;
    const grid = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) row.push(cells[this.idx(x, y)]);
      grid.push(row);
    }
    return grid;
  }
}

export default { ElementaryCA, GameOfLife };

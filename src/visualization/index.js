/**
 * Project OMNISCIENCE — Visualization helpers.
 *
 * Lightweight, dependency-free rendering for terminal and CSV output:
 *   renderGrid(grid, charMap)      — ASCII render of a 2D grid
 *   renderCA(row, charMap)         — ASCII render of a 1D CA row
 *   renderTimeSeries(history, key) — sparkline-ish ASCII time series
 *   toCSV(rows)                    — CSV string from array of objects
 *   writeCSV(path, rows)           — write CSV file (Node fs)
 */

import fs from 'node:fs';

const DEFAULT_CHAR_MAP = { 0: ' ', 1: '█' };

/**
 * Render a 2D grid (array of rows) to ASCII.
 * `cellToChar(cell)` returns a char; if omitted, 0->' ', 1->'█', else '·'.
 */
export function renderGrid(grid, cellToChar, width = grid[0] && grid[0].length) {
  const lines = [];
  for (const row of grid) {
    let line = '';
    for (let j = 0; j < width; j++) {
      const cell = row[j];
      line += cellToChar ? cellToChar(cell, j) : charFor(cell);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function charFor(cell) {
  if (cell === 0 || cell === false || cell === null) return ' ';
  if (cell === 1 || cell === true) return '█';
  if (typeof cell === 'number') {
    if (cell > 0.7) return '#';
    if (cell > 0.4) return '+';
    if (cell > 0.15) return '.';
    return ' ';
  }
  return '·';
}

/**
 * Render a 1D array (e.g. CA row) to ASCII.
 */
export function renderCA(row, cellToChar) {
  let line = '';
  for (let i = 0; i < row.length; i++) {
    line += cellToChar ? cellToChar(row[i], i) : charFor(row[i]);
  }
  return line;
}

/**
 * ASCII sparkline of a numeric time series extracted from history snapshots.
 * history: [{ t, models: { id: { state: {...} } } }, ...]
 * key: 'models.<id>.state.<field>' or function(snapshot) -> number
 */
export function renderTimeSeries(history, key, { height = 12, width = 60 } = {}) {
  let values;
  if (typeof key === 'function') {
    values = history.map(key);
  } else {
    const [modelId, field] = key.split('.').slice(1, 3);
    values = history.map((s) => s.models[modelId] && s.models[modelId].state[field]);
  }
  values = values.filter((v) => typeof v === 'number' && !isNaN(v));
  if (!values.length) return '(no data)';

  // downsample to width
  const step = Math.max(1, Math.floor(values.length / width));
  const sampled = [];
  for (let i = 0; i < values.length; i += step) sampled.push(values[i]);

  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  const rows = [];
  for (let r = 0; r < height; r++) {
    const level = min + (range * (height - 1 - r)) / (height - 1);
    let line = '';
    for (const v of sampled) {
      line += v >= level ? '▪' : ' ';
    }
    rows.push(line);
  }
  return rows.join('\n') + `\nmin=${min.toFixed(3)} max=${max.toFixed(3)}`;
}

/**
 * Convert array of objects to CSV string.
 */
export function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

export function writeCSV(path, rows) {
  fs.writeFileSync(path, toCSV(rows) + '\n');
  return path;
}

export default { renderGrid, renderCA, renderTimeSeries, toCSV, writeCSV };

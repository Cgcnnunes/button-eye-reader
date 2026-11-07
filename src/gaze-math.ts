import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Point } from './dwell';

export interface Sample {
  features: number[];
  point: Point;
}
export interface Mapping {
  means: number[];
  scales: number[];
  x: number[];
  y: number[];
}

export function validationAccepted(errors: Point[]): boolean {
  return (
    errors.length >= 12 &&
    errors.filter(
      (error) =>
        Number.isFinite(error.x) &&
        Number.isFinite(error.y) &&
        error.x >= 0 &&
        error.y >= 0 &&
        error.x <= 0.12 &&
        error.y <= 0.12,
    ).length /
      errors.length >=
      0.9
  );
}

function eye(
  points: NormalizedLandmark[],
  outer: number,
  inner: number,
  iris: number,
  top: number,
  bottom: number,
): number[] | null {
  const a = points[outer],
    b = points[inner],
    i = points[iris],
    t = points[top],
    d = points[bottom];

  if (!a || !b || !i || !t || !d) return null;

  const dx = b.x - a.x,
    dy = b.y - a.y;
  const width2 = dx * dx + dy * dy;

  if (width2 < 0.0001) return null;

  const openness = Math.hypot(t.x - d.x, t.y - d.y) / Math.sqrt(width2);

  if (openness < 0.12) return null;

  return [
    ((i.x - a.x) * dx + (i.y - a.y) * dy) / width2,
    ((i.y - a.y) * dx - (i.x - a.x) * dy) / width2,
  ];
}

export function extractFeatures(points: NormalizedLandmark[]): number[] | null {
  const left = eye(points, 33, 133, 468, 159, 145);
  const right = eye(points, 362, 263, 473, 386, 374);
  const nose = points[1],
    a = points[33],
    b = points[263];

  if (!left || !right || !nose || !a || !b) return null;

  const width = Math.hypot(a.x - b.x, a.y - b.y);

  if (width < 0.08) return null;

  const features = [left[0], left[1], right[0], right[1], nose.x, nose.y, width];

  return features.every(Number.isFinite) ? features : null;
}

function solve(matrix: number[][], vector: number[]): number[] {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  const n = rows.length;

  for (let col = 0; col < n; col++) {
    let pivot = col;

    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }

    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];

    if (Math.abs(rows[col][col]) < 1e-10)
      throw new Error('A calibração não tem dados suficientes.');

    const divisor = rows[col][col];

    for (let k = col; k <= n; k++) rows[col][k] /= divisor;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;

      const factor = rows[row][col];

      for (let k = col; k <= n; k++) rows[row][k] -= factor * rows[col][k];
    }
  }

  return rows.map((row) => row[n]);
}

export function fitMapping(samples: Sample[]): Mapping {
  if (samples.length < 30) throw new Error('A calibração não tem dados suficientes.');

  const n = samples[0].features.length;

  if (
    !n ||
    samples.some(
      (s) =>
        s.features.length !== n ||
        !s.features.every(Number.isFinite) ||
        !Number.isFinite(s.point.x) ||
        !Number.isFinite(s.point.y),
    )
  ) {
    throw new Error('A calibração contém dados inválidos.');
  }

  const means = Array.from(
    { length: n },
    (_, i) => samples.reduce((sum, s) => sum + s.features[i], 0) / samples.length,
  );
  const scales = means.map((mean, i) =>
    Math.max(
      0.001,
      Math.sqrt(samples.reduce((sum, s) => sum + (s.features[i] - mean) ** 2, 0) / samples.length),
    ),
  );
  const rows = samples.map((s) => [1, ...s.features.map((v, i) => (v - means[i]) / scales[i])]);
  const matrix = Array.from({ length: n + 1 }, (_, i) =>
    Array.from(
      { length: n + 1 },
      (_, j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0) + (i === j && i > 0 ? 0.5 : 0),
    ),
  );
  const coefficients = (axis: 'x' | 'y'): number[] =>
    solve(
      matrix,
      Array.from({ length: n + 1 }, (_, i) =>
        rows.reduce((sum, row, k) => sum + row[i] * samples[k].point[axis], 0),
      ),
    );

  return { means, scales, x: coefficients('x'), y: coefficients('y') };
}

export function predict(mapping: Mapping, features: number[]): Point | null {
  if (features.length !== mapping.means.length || !features.every(Number.isFinite)) return null;

  // Do not extrapolate far beyond the head/eye positions seen during calibration.
  const normalized = features.map((v, i) => (v - mapping.means[i]) / mapping.scales[i]);

  if (normalized.some((v) => Math.abs(v) > 5)) return null;

  const row = [1, ...normalized];
  const result = {
    x: row.reduce((sum, v, i) => sum + v * mapping.x[i], 0),
    y: row.reduce((sum, v, i) => sum + v * mapping.y[i], 0),
  };

  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}

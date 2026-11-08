import type { Point } from './dwell';
import type { TrackingFrame } from './gaze';
import type { Sample } from './gaze-math';

export const REPORT_TRANSFER_KEY = 'button-eye-reader.pending-report.v1';
export const MAX_REPORT_BYTES = 32768;
export const REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ErrorSummary {
  bothWithin: number;
  predicted: number;
  xMean: number;
  xRmse: number;
  xWithin: number;
  yMean: number;
  yRmse: number;
  yWithin: number;
}

export interface DiagnosticPoint {
  errors: ErrorSummary | null;
  eyeMean: number[];
  eyeSpread: number[];
  phase: 'calibration' | 'verification';
  samples: number;
  target: Point;
}

export interface DiagnosticReport {
  appVersion: string;
  camera: { height: number; width: number };
  durationMs: number;
  frames: {
    aligned: number;
    multipleFaces: number;
    noFace: number;
    total: number;
    usableEyes: number;
  };
  outcome: 'passed' | 'failed' | 'cancelled' | 'camera-error';
  points: DiagnosticPoint[];
  schema: 1;
  screen: { height: number; width: number };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export class DiagnosticCapture {
  private readonly started: number;
  private readonly report: DiagnosticReport;

  constructor(appVersion: string, width: number, height: number, time: number) {
    this.started = time;

    this.report = {
      appVersion,
      camera: { height: 0, width: 0 },
      durationMs: 0,
      frames: { aligned: 0, multipleFaces: 0, noFace: 0, total: 0, usableEyes: 0 },
      outcome: 'cancelled',
      points: [],
      schema: 1,
      screen: { height, width },
    };
  }

  frame(frame: TrackingFrame, aligned: boolean, width: number, height: number): void {
    this.report.camera = { height, width };

    this.report.frames.total++;

    if (frame.faceCount === 0) this.report.frames.noFace++;

    if (frame.faceCount > 1) this.report.frames.multipleFaces++;

    if (frame.features) this.report.frames.usableEyes++;

    if (aligned) this.report.frames.aligned++;
  }

  point(
    phase: DiagnosticPoint['phase'],
    target: Point,
    samples: Sample[],
    predictions: (Point | null)[] = [],
  ): void {
    if (this.report.points.length >= 13) return;

    const valid = predictions.filter((point): point is Point => point !== null);
    const x = valid.map((point) => point.x - target.x);
    const y = valid.map((point) => point.y - target.y);
    const eyeMean =
      samples[0]?.features.length === 7
        ? Array.from({ length: 4 }, (_, index) =>
            average(samples.map((sample) => sample.features[index])),
          )
        : [];
    const eyeSpread =
      samples[0]?.features.length === 7
        ? Array.from({ length: 4 }, (_, index) => {
            const values = samples.map((sample) => sample.features[index]);
            const mean = average(values);

            return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
          })
        : [];

    this.report.points.push({
      errors:
        phase === 'verification'
          ? {
              bothWithin: valid.filter(
                (point) =>
                  Math.abs(point.x - target.x) <= 0.12 && Math.abs(point.y - target.y) <= 0.12,
              ).length,
              predicted: valid.length,
              xMean: average(x),
              xRmse: Math.sqrt(average(x.map((value) => value ** 2))),
              xWithin: x.filter((value) => Math.abs(value) <= 0.12).length,
              yMean: average(y),
              yRmse: Math.sqrt(average(y.map((value) => value ** 2))),
              yWithin: y.filter((value) => Math.abs(value) <= 0.12).length,
            }
          : null,
      eyeMean,
      eyeSpread,
      phase,
      samples: samples.length,
      target: { ...target },
    });
  }

  finish(outcome: DiagnosticReport['outcome'], time: number): DiagnosticReport {
    this.report.outcome = outcome;

    this.report.durationMs = Math.max(0, Math.round(time - this.started));

    return this.report;
  }
}

function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function number(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, max: number): value is number {
  return number(value, 0, max) && Number.isInteger(value);
}

function dimensions(value: unknown): boolean {
  return (
    object(value, ['height', 'width']) &&
    integer(value.height, 16384) &&
    integer(value.width, 16384)
  );
}

function diagnosticPoint(value: unknown): boolean {
  if (
    !object(value, ['errors', 'eyeMean', 'eyeSpread', 'phase', 'samples', 'target']) ||
    !['calibration', 'verification'].includes(String(value.phase)) ||
    !integer(value.samples, 10000) ||
    !object(value.target, ['x', 'y']) ||
    !number(value.target.x, 0, 1) ||
    !number(value.target.y, 0, 1) ||
    !Array.isArray(value.eyeMean) ||
    (value.eyeMean.length !== 0 && value.eyeMean.length !== 4) ||
    !value.eyeMean.every((mean: unknown) => number(mean, -10, 10)) ||
    !Array.isArray(value.eyeSpread) ||
    value.eyeMean.length !== value.eyeSpread.length ||
    (value.eyeSpread.length !== 0 && value.eyeSpread.length !== 4) ||
    !value.eyeSpread.every((spread: unknown) => number(spread, 0, 10))
  )
    return false;

  if (value.phase === 'calibration') return value.errors === null;

  const errors = value.errors;

  return (
    object(errors, [
      'bothWithin',
      'predicted',
      'xMean',
      'xRmse',
      'xWithin',
      'yMean',
      'yRmse',
      'yWithin',
    ]) &&
    integer(errors.predicted, value.samples) &&
    integer(errors.bothWithin, errors.predicted) &&
    integer(errors.xWithin, errors.predicted) &&
    integer(errors.yWithin, errors.predicted) &&
    errors.bothWithin <= Math.min(errors.xWithin, errors.yWithin) &&
    number(errors.xMean, -20, 20) &&
    number(errors.yMean, -20, 20) &&
    number(errors.xRmse, 0, 20) &&
    number(errors.yRmse, 0, 20)
  );
}

export function isDiagnosticReport(value: unknown): value is DiagnosticReport {
  if (
    !object(value, [
      'appVersion',
      'camera',
      'durationMs',
      'frames',
      'outcome',
      'points',
      'schema',
      'screen',
    ]) ||
    value.schema !== 1 ||
    typeof value.appVersion !== 'string' ||
    !/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-test)?$/.test(value.appVersion) ||
    !dimensions(value.camera) ||
    !dimensions(value.screen) ||
    !integer(value.durationMs, 3600000) ||
    !['passed', 'failed', 'cancelled', 'camera-error'].includes(String(value.outcome)) ||
    !object(value.frames, ['aligned', 'multipleFaces', 'noFace', 'total', 'usableEyes']) ||
    !integer(value.frames.total, 100000) ||
    !Array.isArray(value.points) ||
    value.points.length > 13 ||
    !value.points.every(diagnosticPoint)
  )
    return false;

  const frames = value.frames;
  const total = frames.total;

  return (
    integer(total, 100000) &&
    ['aligned', 'multipleFaces', 'noFace', 'usableEyes'].every((key) => integer(frames[key], total))
  );
}

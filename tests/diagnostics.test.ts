import { describe, expect, it } from 'vitest';
import { DiagnosticCapture, isDiagnosticReport } from '../src/diagnostics';

function capture(): DiagnosticCapture {
  return new DiagnosticCapture('0.3.4', 1180, 820, 1000);
}

describe('numerical diagnostic capture', () => {
  it('summarizes errors and eye variability without retaining raw samples or landmarks', () => {
    const collector = capture();
    const samples = [0, 0.1].map((offset) => ({
      features: [0.5 + offset, 0.4, 0.5, 0.4, 0.9, 0.8, 0.28],
      point: { x: 0.5, y: 0.5 },
    }));

    collector.frame(
      { faceBounds: null, faceCount: 0, features: null, time: 1000 },
      false,
      640,
      480,
    );

    collector.frame(
      { faceBounds: null, faceCount: 2, features: null, time: 1080 },
      false,
      640,
      480,
    );

    collector.frame(
      { faceBounds: null, faceCount: 1, features: [0.5], time: 1160 },
      true,
      640,
      480,
    );

    collector.point('calibration', { x: 0.5, y: 0.5 }, samples);

    collector.point('verification', { x: 0.5, y: 0.5 }, samples, [
      { x: 0.6, y: 0.5 },
      { x: 0.9, y: 0.1 },
      null,
    ]);

    const report = collector.finish('failed', 3000);

    expect(report.durationMs).toBe(2000);

    expect(report.frames).toEqual({
      aligned: 1,
      multipleFaces: 1,
      noFace: 1,
      total: 3,
      usableEyes: 1,
    });

    expect(report.points[0].eyeSpread[0]).toBeCloseTo(0.05);

    expect(report.points[0].eyeMean[0]).toBeCloseTo(0.55);

    expect(report.points[1].errors).toMatchObject({
      bothWithin: 1,
      predicted: 2,
      xMean: 0.25,
      xWithin: 1,
      yMean: -0.2,
      yWithin: 1,
    });

    expect(JSON.stringify(report)).not.toMatch(/features|faceBounds|landmarks|nose/);

    expect(isDiagnosticReport(report)).toBe(true);
  });

  it('bounds point collection and supports empty/cancelled attempts', () => {
    const collector = capture();

    for (let index = 0; index < 20; index++)
      collector.point('verification', { x: 0.5, y: 0.5 }, []);

    const report = collector.finish('cancelled', 500);

    expect(report.points).toHaveLength(13);

    expect(report.durationMs).toBe(0);

    expect(report.points[0].errors?.predicted).toBe(0);

    expect(isDiagnosticReport(report)).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { ...capture().finish('cancelled', 1000), image: 'private' },
    { ...capture().finish('cancelled', 1000), schema: 2 },
    { ...capture().finish('cancelled', 1000), appVersion: '<script>' },
    { ...capture().finish('cancelled', 1000), screen: { height: -1, width: 800 } },
    { ...capture().finish('cancelled', 1000), durationMs: Infinity },
    {
      ...capture().finish('cancelled', 1000),
      frames: { aligned: 1, multipleFaces: 0, noFace: 0, total: 0, usableEyes: 0 },
    },
    {
      ...capture().finish('cancelled', 1000),
      points: [
        {
          errors: null,
          eyeMean: [],
          eyeSpread: [],
          phase: 'calibration',
          samples: 1,
          target: { x: NaN, y: 0 },
        },
      ],
    },
    {
      ...capture().finish('cancelled', 1000),
      points: [
        {
          errors: null,
          eyeMean: [],
          eyeSpread: [0],
          phase: 'calibration',
          samples: 1,
          target: { x: 0, y: 0 },
        },
      ],
    },
    {
      ...capture().finish('cancelled', 1000),
      points: [
        {
          errors: null,
          eyeMean: [],
          eyeSpread: [],
          phase: 'verification',
          samples: 1,
          target: { x: 0, y: 0 },
        },
      ],
    },
  ])('rejects invalid, extra or identifying fields: %j', (value) => {
    expect(isDiagnosticReport(value)).toBe(false);
  });
});

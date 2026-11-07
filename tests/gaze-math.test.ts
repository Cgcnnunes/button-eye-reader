import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import {
  extractFeatures,
  fitMapping,
  predict,
  type Sample,
  validationAccepted,
} from '../src/gaze-math';

describe('gaze calibration math', () => {
  it('learns a mapping from changing eye positions', () => {
    const samples: Sample[] = [];

    for (let x = 0.1; x < 1; x += 0.2)
      for (let y = 0.1; y < 1; y += 0.2) {
        for (let repeat = 0; repeat < 4; repeat++)
          samples.push({ features: [x * 0.3 + 0.4, y * 0.1 + 0.2], point: { x, y } });
      }

    const mapping = fitMapping(samples);
    const result = predict(mapping, [0.49, 0.27]);

    expect(result?.x).toBeCloseTo(0.3, 2);

    expect(result?.y).toBeCloseTo(0.7, 2);

    expect(predict(mapping, [100, 100])).toBeNull();

    expect(predict(mapping, [NaN, 0.2])).toBeNull();

    expect(predict(mapping, [0.49])).toBeNull();
  });

  it('rejects insufficient and inconsistent training data', () => {
    expect(() => fitMapping([])).toThrow();

    const invalid = Array.from({ length: 30 }, () => ({ features: [NaN], point: { x: 0, y: 0 } }));

    expect(() => fitMapping(invalid)).toThrow();
  });

  it('does not accept a static eye signal as reliable gaze', () => {
    const samples = Array.from({ length: 40 }, (_, i) => ({
      features: [0.5, 0.5],
      point: { x: i % 2 ? 0.1 : 0.9, y: i % 2 ? 0.1 : 0.9 },
    }));
    const result = predict(fitMapping(samples), [0.5, 0.5]);

    if (!result) {
      throw new Error('Expected a valid prediction.');
    }

    expect(
      validationAccepted(
        Array.from({ length: 20 }, () => ({
          x: Math.abs(result.x - 0.25),
          y: Math.abs(result.y - 0.3),
        })),
      ),
    ).toBe(false);
  });

  it('requires 90% of individual samples within 12% on both axes', () => {
    const good = { x: 0.12, y: 0.12 },
      bad = { x: 0.121, y: 0.05 };

    expect(validationAccepted([...Array.from({ length: 18 }, () => good), bad, bad])).toBe(true);

    expect(validationAccepted([...Array.from({ length: 17 }, () => good), bad, bad, bad])).toBe(
      false,
    );

    expect(validationAccepted(Array.from({ length: 11 }, () => good))).toBe(false);

    expect(validationAccepted(Array.from({ length: 20 }, () => ({ x: 0.05, y: 0.121 })))).toBe(
      false,
    );

    expect(validationAccepted(Array.from({ length: 20 }, () => ({ x: NaN, y: 0 })))).toBe(false);
  });

  it('rejects absent, distant and closed eyes', () => {
    expect(extractFeatures([])).toBeNull();

    const landmark = (x: number, y: number): NormalizedLandmark => ({ visibility: 1, x, y, z: 0 });
    const points: NormalizedLandmark[] = Array.from({ length: 478 }, () => landmark(0.5, 0.5));

    points[33] = landmark(0.3, 0.5);

    points[133] = landmark(0.4, 0.5);

    points[362] = landmark(0.6, 0.5);

    points[263] = landmark(0.7, 0.5);

    points[468] = landmark(0.35, 0.5);

    points[473] = landmark(0.65, 0.5);

    expect(extractFeatures(points)).toBeNull();

    points[159] = landmark(0.35, 0.48);

    points[145] = landmark(0.35, 0.52);

    points[386] = landmark(0.65, 0.48);

    points[374] = landmark(0.65, 0.52);

    expect(extractFeatures(points)).toHaveLength(7);

    points[468].x = NaN;

    expect(extractFeatures(points)).toBeNull();
  });
});

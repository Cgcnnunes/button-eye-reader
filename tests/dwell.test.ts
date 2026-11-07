import { describe, expect, it } from 'vitest';
import { Dwell, DWELL_MS, type Point, type Target } from '../src/dwell';

const targets: Target[] = [
  { id: 'a', rect: { bottom: 200, left: 0, right: 200, top: 0 } },
  { id: 'b', rect: { bottom: 200, left: 240, right: 440, top: 0 } },
];
const a = { x: 100, y: 100 };
const b = { x: 340, y: 100 };

function look(
  dwell: Dwell,
  point: Point,
  start: number,
  duration: number,
): ReturnType<Dwell['update']> {
  let result = dwell.update(point, targets, start);

  for (let time = start + 100; time <= start + duration; time += 100)
    result = dwell.update(point, targets, time);

  return result;
}

describe('two-second dwell safeguards', () => {
  it('fires at exactly two seconds, not earlier', () => {
    const dwell = new Dwell();

    expect(look(dwell, a, 0, DWELL_MS - 100).fire).toBe(false);

    expect(dwell.update(a, targets, DWELL_MS)).toEqual({ fire: true, id: 'a', progress: 1 });
  });

  it('does not repeat while the eyes stay on the selected button', () => {
    const dwell = new Dwell();

    expect(look(dwell, a, 0, 2000).fire).toBe(true);

    expect(look(dwell, a, 2100, 5000).fire).toBe(false);
  });

  it('requires 400ms away, then a new two-second dwell', () => {
    const dwell = new Dwell();

    look(dwell, a, 0, 2000);

    expect(look(dwell, b, 2100, 400).id).toBe(null);

    expect(look(dwell, b, 2600, 1900).fire).toBe(false);

    expect(dwell.update(b, targets, 4600).fire).toBe(true);
  });

  it('tracking loss is not treated as looking away to unlock repeats', () => {
    const dwell = new Dwell();

    look(dwell, a, 0, 2000);

    dwell.update(null, targets, 2200);

    expect(look(dwell, a, 2300, 3000).fire).toBe(false);
  });

  it('resets progress after a blink or missing frame', () => {
    const dwell = new Dwell();

    look(dwell, a, 0, 1900);

    dwell.update(null, targets, 2000);

    expect(dwell.update(a, targets, 2100).progress).toBe(0);
  });

  it('resets on stale tracking and when moving to another target', () => {
    const dwell = new Dwell();

    look(dwell, a, 0, 1900);

    expect(dwell.update(a, targets, 2300).progress).toBe(0);

    expect(dwell.update(b, targets, 2400).progress).toBe(0);
  });

  it('never selects gaps or the button edge', () => {
    const dwell = new Dwell();

    expect(look(dwell, { x: 220, y: 100 }, 0, 3000).id).toBe(null);

    expect(look(dwell, { x: 2, y: 100 }, 3100, 3000).id).toBe(null);
  });

  it('retains the lock across a changed screen or reset', () => {
    const dwell = new Dwell();

    look(dwell, a, 0, 2000);

    dwell.reset();

    expect(look(dwell, a, 2100, 3000).fire).toBe(false);
  });
});

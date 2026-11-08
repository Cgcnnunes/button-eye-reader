import { describe, expect, it } from 'vitest';
import { defaultBoard, movePhrase } from '../src/store';

describe('caregiver phrase ordering', () => {
  it('moves catalogue entries without changing IDs, text, slots or the input', () => {
    const board = defaultBoard();
    const reordered = movePhrase(board, 0, 4, false);

    expect(reordered.phrases[4]).toEqual(board.phrases[0]);

    expect(reordered.slots).toEqual(board.slots);

    expect(board.phrases[0].text).toBe('Sim');

    expect(movePhrase(reordered, 4, 0, false)).toEqual(board);

    expect(movePhrase(board, 0, 0, false)).toEqual(board);
  });

  it('moves only speaking positions independently of the catalogue', () => {
    const board = defaultBoard();
    const reordered = movePhrase(board, 0, 3, true);

    expect(reordered.slots).toEqual([
      board.slots[1],
      board.slots[2],
      board.slots[3],
      board.slots[0],
    ]);

    expect(reordered.phrases).toEqual(board.phrases);

    expect(movePhrase(reordered, 3, 0, true)).toEqual(board);
  });

  it('rejects invalid bounds and non-integer positions', () => {
    for (const slotsOnly of [true, false]) {
      for (const [from, to] of [
        [-1, 0],
        [0, -1],
        [100, 0],
        [0, 100],
        [0.5, 0],
        [0, Number.NaN],
      ]) {
        expect(() => movePhrase(defaultBoard(), from, to, slotsOnly)).toThrow('posição');
      }
    }
  });
});

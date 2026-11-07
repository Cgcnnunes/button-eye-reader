import { describe, expect, it } from 'vitest';
import { addPhrase, defaultBoard, MAX_TEXT, parseBoard, replaceSlot } from '../src/store';

describe('local pt-PT board', () => {
  it('starts with four phrases and a Portuguese catalogue', () => {
    const board = defaultBoard();

    expect(board.slots).toHaveLength(4);

    expect(board.slots.map((id) => board.phrases.find((p) => p.id === id)?.text)).toEqual([
      'Sim',
      'Não',
      'Quero água',
      'Preciso de ajuda',
    ]);

    expect(board.phrases.length).toBeGreaterThan(20);
  });

  it('round-trips saved custom phrases and slot replacements', () => {
    const initial = defaultBoard();
    const added = addPhrase(initial, '  Quero   ouvir o rádio  ');
    const phrase = added.phrases.at(-1);

    if (!phrase) {
      throw new Error('Expected a new phrase.');
    }

    const replaced = replaceSlot(added, 2, phrase.id);

    expect(parseBoard(JSON.stringify(replaced))).toEqual(replaced);

    expect(phrase.text).toBe('Quero ouvir o rádio');

    expect(initial.phrases).toHaveLength(28);

    expect(initial.slots[2]).toBe('template-2');
  });

  it('rejects duplicates, blank and oversized phrases', () => {
    const board = defaultBoard();

    expect(() => addPhrase(board, '  SIM ')).toThrow('já existe');

    expect(() => addPhrase(board, ' ')).toThrow();

    expect(() => addPhrase(board, 'x'.repeat(MAX_TEXT + 1))).toThrow();

    expect(addPhrase(board, 'x'.repeat(MAX_TEXT)).phrases.at(-1)?.text).toHaveLength(MAX_TEXT);
  });

  it.each([-1, 4, 0.5, NaN])('rejects invalid slot %s', (slot) => {
    expect(() => replaceSlot(defaultBoard(), slot, 'template-0')).toThrow();
  });

  it('rejects unknown phrases', () => {
    expect(() => replaceSlot(defaultBoard(), 0, 'missing')).toThrow();
  });

  it.each(['null', '{}', 'bad JSON', '{"version":2,"phrases":[],"slots":[]}'])(
    'rejects corrupt storage %s',
    (raw) => {
      expect(() => parseBoard(raw)).toThrow();
    },
  );

  it('rejects missing slot references, duplicate IDs and invalid text types', () => {
    const board = defaultBoard();

    expect(() =>
      parseBoard(JSON.stringify({ ...board, slots: ['missing', ...board.slots.slice(1)] })),
    ).toThrow();

    expect(() =>
      parseBoard(JSON.stringify({ ...board, phrases: [...board.phrases, board.phrases[0]] })),
    ).toThrow();

    expect(() =>
      parseBoard(JSON.stringify({ ...board, phrases: [{ id: 'template-0', text: 42 }] })),
    ).toThrow();
  });

  it('preserves literal HTML as text, not markup', () => {
    expect(addPhrase(defaultBoard(), '<img src=x onerror=alert(1)>').phrases.at(-1)?.text).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});

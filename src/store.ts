export interface Phrase {
  id: string;
  text: string;
}

export interface Board {
  phrases: Phrase[];
  slots: [string, string, string, string];
  version: 1;
}

export const STORAGE_KEY = 'button-eye-reader.pt-PT.v1';
export const MAX_TEXT = 100;

const templates = [
  'Sim',
  'Não',
  'Quero água',
  'Preciso de ajuda',
  'Tenho fome',
  'Estou cansado',
  'Tenho frio',
  'Tenho calor',
  'Estou bem',
  'Não estou bem',
  'Quero descansar',
  'Quero mudar de posição',
  'Preciso de ir à casa de banho',
  'Estou desconfortável',
  'Mais',
  'Menos',
  'Por favor',
  'Obrigado',
  'Quero estar contigo',
  'Quero ouvir música',
  'Liga a televisão',
  'Desliga a televisão',
  'Espera um pouco',
  'Não percebeste',
  'Quero dizer outra coisa',
  'Gosto de ti',
  'Quero silêncio',
  'Chama alguém',
  'Tenho dores',
];

export function defaultBoard(): Board {
  const phrases = templates.map((text, index) => ({ id: `template-${index}`, text }));

  return { phrases, slots: ['template-0', 'template-1', 'template-12', 'template-28'], version: 1 };
}

export function upgradeDefaultSlots(board: Board): Board {
  const changes = [
    { oldId: 'template-2', oldText: 'Quero água', slot: 2, text: 'Preciso de ir à casa de banho' },
    { oldId: 'template-3', oldText: 'Preciso de ajuda', slot: 3, text: 'Tenho dores' },
  ];
  let next = board;

  for (const change of changes) {
    if (
      next.slots[change.slot] !== change.oldId ||
      !next.phrases.some((phrase) => phrase.id === change.oldId && phrase.text === change.oldText)
    )
      continue;

    let replacement = next.phrases.find(
      (phrase) => phrase.text.toLocaleLowerCase('pt-PT') === change.text.toLocaleLowerCase('pt-PT'),
    );

    if (!replacement) {
      next = addPhrase(next, change.text);

      replacement = next.phrases.at(-1);
    }

    if (!replacement) throw new Error('A frase de substituição não foi encontrada.');

    next = replaceSlot(next, change.slot, replacement.id);
  }

  return next;
}

export function parseBoard(raw: string): Board {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('As frases guardadas não têm um formato JSON válido.', { cause: error });

    throw error;
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('phrases' in value) ||
    !Array.isArray(value.phrases) ||
    !('slots' in value) ||
    !Array.isArray(value.slots) ||
    value.slots.length !== 4
  ) {
    throw new Error('O formato das frases guardadas não é válido.');
  }

  const phrases: Phrase[] = [];
  const ids = new Set<string>();

  const storedPhrases: unknown[] = value.phrases;

  for (const item of storedPhrases) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      !('text' in item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      item.text.length > MAX_TEXT
    ) {
      throw new Error('Existe uma frase guardada inválida.');
    }

    phrases.push({ id: item.id, text: item.text });

    ids.add(item.id);
  }

  if (!value.slots.every((id: unknown) => typeof id === 'string' && ids.has(id))) {
    throw new Error('Um dos botões tem uma frase inválida.');
  }

  const [a, b, c, d] = value.slots as string[];

  return { phrases, slots: [a, b, c, d], version: 1 };
}

export function addPhrase(board: Board, text: string): Board {
  const clean = text.trim().replace(/\s+/g, ' ');

  if (!clean || clean.length > MAX_TEXT)
    throw new Error(`Escreva entre 1 e ${MAX_TEXT} caracteres.`);

  if (
    board.phrases.some(
      (phrase) => phrase.text.toLocaleLowerCase('pt-PT') === clean.toLocaleLowerCase('pt-PT'),
    )
  ) {
    throw new Error('Esta frase já existe no catálogo.');
  }

  return { ...board, phrases: [...board.phrases, { id: crypto.randomUUID(), text: clean }] };
}

export function replaceSlot(board: Board, slot: number, phraseId: string): Board {
  if (
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 3 ||
    !board.phrases.some((phrase) => phrase.id === phraseId)
  ) {
    throw new Error('Não foi possível substituir a frase.');
  }

  const slots: Board['slots'] = [...board.slots];

  slots[slot] = phraseId;

  return { ...board, slots };
}

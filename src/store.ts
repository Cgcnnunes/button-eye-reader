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
  { id: 'template-0', text: 'Sim' },
  { id: 'template-1', text: 'Não' },
  { id: 'template-12', text: 'Preciso de ir à casa de banho' },
  { id: 'template-28', text: 'Tenho dores' },
  { id: 'template-4', text: 'Tenho fome' },
  { id: 'template-29', text: 'Tenho sede' },
  { id: 'template-6', text: 'Tenho frio' },
  { id: 'template-7', text: 'Tenho calor' },
  { id: 'template-13', text: 'Estou desconfortável' },
  { id: 'template-11', text: 'Quero mudar de posição' },
  { id: 'template-10', text: 'Quero descansar' },
  { id: 'template-3', text: 'Preciso de ajuda' },
  { id: 'template-5', text: 'Estou cansado' },
  { id: 'template-9', text: 'Não estou bem' },
  { id: 'template-8', text: 'Estou bem' },
  { id: 'template-2', text: 'Quero água' },
  { id: 'template-27', text: 'Chama alguém' },
  { id: 'template-23', text: 'Não percebeste' },
  { id: 'template-24', text: 'Quero dizer outra coisa' },
  { id: 'template-14', text: 'Mais' },
  { id: 'template-15', text: 'Menos' },
  { id: 'template-16', text: 'Por favor' },
  { id: 'template-17', text: 'Obrigado' },
  { id: 'template-20', text: 'Liga a televisão' },
  { id: 'template-21', text: 'Desliga a televisão' },
  { id: 'template-25', text: 'Gosto de ti' },
];

export function defaultBoard(): Board {
  const phrases = templates.map((phrase) => ({ ...phrase }));

  return { phrases, slots: ['template-0', 'template-1', 'template-12', 'template-28'], version: 1 };
}

export function upgradeCatalogue(board: Board): Board {
  const removed = [
    { id: 'template-18', text: 'Quero estar contigo' },
    { id: 'template-19', text: 'Quero ouvir música' },
    { id: 'template-22', text: 'Espera um pouco' },
    { id: 'template-26', text: 'Quero silêncio' },
  ];
  const retained = board.phrases.filter(
    (phrase) => !removed.some((item) => item.id === phrase.id && item.text === phrase.text),
  );
  const ordered: Phrase[] = [];

  for (const template of templates) {
    const existing = retained.find(
      (phrase) =>
        phrase.text.toLocaleLowerCase('pt-PT') === template.text.toLocaleLowerCase('pt-PT'),
    );

    ordered.push(
      existing ?? {
        id: retained.some((phrase) => phrase.id === template.id)
          ? crypto.randomUUID()
          : template.id,
        text: template.text,
      },
    );
  }

  const phrases = [
    ...ordered,
    ...retained.filter((phrase) => !ordered.some((item) => item.id === phrase.id)),
  ];
  const slots: Board['slots'] = [...board.slots];

  for (let index = 0; index < slots.length; index++) {
    if (!phrases.some((phrase) => phrase.id === slots[index])) slots[index] = ordered[index].id;
  }

  if (
    phrases.length === board.phrases.length &&
    phrases.every((phrase, index) => phrase.id === board.phrases[index].id) &&
    slots.every((id, index) => id === board.slots[index])
  )
    return board;

  return { ...board, phrases, slots };
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

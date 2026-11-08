import './style.css';
import { Speaker } from './speech';
import {
  addPhrase,
  type Board,
  defaultBoard,
  MAX_TEXT,
  parseBoard,
  type Phrase,
  replaceSlot,
  STORAGE_KEY,
  upgradeDefaultSlots,
} from './store';

type Screen = 'board' | 'catalogue' | 'replace' | 'add';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) throw new Error('O elemento principal não foi encontrado.');

const app = root;
let board = defaultBoard();
let initialError = '';
let storageHealthy = true;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

try {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (raw !== null) {
    board = parseBoard(raw);

    board = readSavedBoard(raw);
  }
} catch (error) {
  storageHealthy = false;

  initialError = `Não foi possível ler as frases guardadas. Os dados existentes não serão alterados. ${errorMessage(error)}`;
}

let screen: Screen = 'board';
let page = 0;
let selected: Phrase | null = null;

app.innerHTML = `
  <div id="shell" class="shell">
    <header>
      <section class="guidance" aria-label="Instruções"><div><h1 id="screen-title"></h1><p id="screen-hint"></p></div></section>
    </header>
    <main id="content"></main>
    <div class="feedback"><p id="spoken" role="status" aria-live="polite"></p><p id="notice" role="alert"></p></div>
    <footer>
      <section id="caregiver-panel" hidden aria-labelledby="caregiver-label">
        <div class="panel-heading">
          <h2 id="caregiver-label">Opções de quem acompanha</h2>
          <button id="caregiver-close" type="button" class="helper">Fechar</button>
        </div>
        <p>Prepare o som e as frases. Para evitar escolhas involuntárias, pause o Rastreamento dos Olhos nos ajustes do iPad antes de usar esta área.</p>
        <div class="helper-buttons" role="group" aria-labelledby="caregiver-label">
          <button id="sound" type="button" class="helper"><strong>Testar som</strong><span>Confirmar a voz e o volume</span></button>
          <button id="add" type="button" class="helper" data-action="add"><strong>Adicionar frase</strong><span>Escrever uma nova frase no catálogo</span></button>
          <button id="eye-help" type="button" class="helper" aria-expanded="false" aria-controls="eye-help-text"><strong>Ajuda com o Rastreamento dos Olhos</strong><span>Como ativar ou pausar no iPad</span></button>
        </div>
        <p id="eye-help-text" hidden>No iPad: Ajustes -> Acessibilidade -> Rastreamento dos Olhos. Se disponível, configure o Atalho de acessibilidade para acesso pelo botão superior. Esta aplicação não ativa nem desativa o rastreamento.</p>
      </section>
      <div class="footer-bar">
        <div class="caregiver-entry">
          <button id="caregiver-toggle" type="button" class="helper" aria-expanded="false" aria-controls="caregiver-panel">Acompanhante · Opções</button>
          <span id="caregiver-hint">Peça a quem acompanha para aceder às configurações.</span>
        </div>
        <div class="privacy"><span>As frases ficam neste navegador.</span><span class="release-label"><small class="experimental">EXPERIMENTAL</small><span>v${__APP_VERSION__}</span></span></div>
      </div>
    </footer>
  </div>`;

function element(id: string): HTMLElement;

function element<T extends HTMLElement>(id: string, expected: new () => T): T;

function element(id: string, expected?: new () => HTMLElement): HTMLElement {
  const result = document.getElementById(id);

  if (!result) throw new Error(`Elemento em falta: ${id}`);

  if (expected && !(result instanceof expected)) {
    throw new Error(`Elemento com tipo incorreto: ${id}`);
  }

  return result;
}

const content = element('content');
const notice = element('notice');

function notify(message: string): void {
  notice.textContent = message;
}

const speaker = new Speaker(notify, (busy) => {
  if (!busy) element('spoken').textContent = 'Pronto para a próxima frase.';
});

function phraseFor(id: string): Phrase {
  const phrase = board.phrases.find((item) => item.id === id);

  if (!phrase) throw new Error('A frase não foi encontrada.');

  return phrase;
}

function makeButton(
  text: string,
  action: string,
  options: { disabled?: boolean; label?: string; secondary?: boolean } = {},
): HTMLButtonElement {
  const button = document.createElement('button');

  button.type = 'button';

  button.className = options.secondary ? 'control-button' : 'phrase-button';

  if (!options.secondary && text.length > 45) button.classList.add('long-phrase');
  else if (!options.secondary && text.length > 24) button.classList.add('medium-phrase');

  button.dataset.action = action;

  button.disabled = options.disabled ?? false;

  if (options.label) button.setAttribute('aria-label', options.label);

  const label = document.createElement('span');

  label.className = 'button-text';

  label.textContent = text;

  button.append(label);

  if (!options.secondary && screen !== 'board') {
    const hint = document.createElement('small');

    hint.textContent = screen === 'replace' ? 'Substituir este botão' : 'Escolher frase';

    button.append(hint);
  }

  button.addEventListener('click', () => {
    activate(button);
  });

  return button;
}

function render(): void {
  content.replaceChildren();

  element('shell').classList.toggle('board-screen', screen === 'board');

  element('add').hidden = screen !== 'board';

  setCaregiverPanel(false);

  const grid = document.createElement('div');

  grid.className = 'phrase-grid';

  const controls = document.createElement('nav');

  controls.className = 'controls';

  controls.setAttribute('aria-label', 'Opções de frases');

  element('screen-title').textContent =
    screen === 'board'
      ? 'O que quer dizer?'
      : screen === 'catalogue'
        ? 'Escolha uma frase'
        : screen === 'replace'
          ? 'Qual botão quer mudar?'
          : 'Adicionar uma frase';

  element('screen-hint').textContent =
    screen === 'board'
      ? 'Toque numa frase ou use o Controlo ocular do iPad.'
      : screen === 'catalogue'
        ? `Catálogo · página ${page + 1} de ${Math.ceil(board.phrases.length / 4)}`
        : screen === 'replace'
          ? `Vai colocar: «${selected?.text ?? ''}»`
          : 'Área de escrita para quem acompanha.';

  if (screen === 'board' || screen === 'replace') {
    board.slots.forEach((id, index) => {
      grid.append(
        makeButton(phraseFor(id).text, screen === 'board' ? `speak:${index}` : `replace:${index}`, {
          label:
            screen === 'replace'
              ? `Botão ${index + 1}: ${phraseFor(id).text}. Substituir.`
              : undefined,
        }),
      );
    });

    if (screen === 'board') {
      controls.append(makeButton('Escolher outra frase', 'catalogue', { secondary: true }));

      controls.classList.add('board-controls');
    } else {
      controls.append(makeButton('Voltar ao catálogo', 'catalogue', { secondary: true }));

      controls.append(makeButton('Cancelar', 'board', { secondary: true }));
    }
  } else if (screen === 'catalogue') {
    board.phrases.slice(page * 4, page * 4 + 4).forEach((phrase) => {
      grid.append(makeButton(phrase.text, `choose:${phrase.id}`));
    });

    controls.classList.add('three-controls');

    controls.append(makeButton('Anterior', 'previous', { disabled: page === 0, secondary: true }));

    controls.append(makeButton('Voltar às frases', 'board', { secondary: true }));

    controls.append(
      makeButton('Seguinte', 'next', {
        disabled: (page + 1) * 4 >= board.phrases.length,
        secondary: true,
      }),
    );
  } else {
    renderForm();

    return;
  }

  content.append(grid, controls);
}

function persist(next: Board): boolean {
  if (!storageHealthy) {
    notify(
      'As frases guardadas não puderam ser lidas. Não as vamos substituir. Peça ajuda para recuperar os dados do navegador.',
    );

    return false;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

    board = next;

    return true;
  } catch (error) {
    notify(`Não foi possível guardar. Nada foi alterado. ${errorMessage(error)}`);

    return false;
  }
}

function readSavedBoard(raw: string): Board {
  const saved = parseBoard(raw);
  const upgraded = upgradeDefaultSlots(saved);

  if (upgraded !== saved) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded));
    } catch (error) {
      throw new Error(`Não foi possível guardar a atualização dos botões. ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  return upgraded;
}

function activate(button: HTMLButtonElement): void {
  if (button.disabled) return;

  const action = button.dataset.action ?? '';

  try {
    if (action.startsWith('speak:')) {
      const text = phraseFor(board.slots[Number(action.split(':')[1])]).text;

      speaker.speak(text);

      if (speaker.speaking) element('spoken').textContent = `A dizer: «${text}»`;

      return;
    }

    if (action.startsWith('choose:')) {
      selected = phraseFor(action.slice(7));

      screen = 'replace';
    } else if (action.startsWith('replace:')) {
      if (!selected) throw new Error('Escolha primeiro uma frase.');

      if (!persist(replaceSlot(board, Number(action.slice(8)), selected.id))) return;

      element('spoken').textContent = `Botão atualizado: «${selected.text}».`;

      screen = 'board';

      selected = null;
    } else if (action === 'previous') page = Math.max(0, page - 1);
    else if (action === 'next') page = Math.min(Math.ceil(board.phrases.length / 4) - 1, page + 1);
    else if (action === 'catalogue') screen = 'catalogue';
    else if (action === 'board') {
      screen = 'board';

      selected = null;
    } else if (action === 'add') screen = 'add';

    render();
  } catch (error) {
    notify(errorMessage(error));
  }
}

function renderForm(): void {
  const form = document.createElement('form');

  form.className = 'phrase-form';

  form.innerHTML = `
    <label for="new-phrase">Palavra ou frase em português</label>
    <textarea id="new-phrase" name="phrase" maxlength="${MAX_TEXT}" rows="3" required placeholder="Por exemplo: Quero ouvir música"></textarea>
    <p>Até ${MAX_TEXT} caracteres. Fica guardada no catálogo deste iPad.</p>
    <p>Área para quem acompanha. O Controlo ocular do iPad é gerido nas definições do dispositivo, não nesta aplicação.</p>
    <div class="controls"><button type="submit" class="control-button">Guardar no catálogo</button><button type="button" id="form-back" class="control-button">Cancelar</button></div>`;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    try {
      const text = element('new-phrase', HTMLTextAreaElement).value;
      const next = addPhrase(board, text);

      if (!persist(next)) return;

      screen = 'catalogue';

      notify('Frase guardada. Escolha-a no catálogo para a colocar num botão.');

      render();
    } catch (error) {
      notify(errorMessage(error));
    }
  });

  content.append(form);

  element('form-back').addEventListener('click', () => {
    screen = 'board';

    render();
  });

  element('new-phrase', HTMLTextAreaElement).focus();
}

element('sound').addEventListener('click', () => {
  speaker.speak('Olá. Esta é a minha voz.');
});

const addButton = element('add', HTMLButtonElement);

function setCaregiverPanel(open: boolean): void {
  element('caregiver-panel').hidden = !open;

  element('caregiver-toggle').setAttribute('aria-expanded', String(open));

  element('caregiver-hint').hidden = open;

  element('shell').classList.toggle('caregiver-open', open);

  if (!open) {
    element('eye-help-text').hidden = true;

    element('eye-help').setAttribute('aria-expanded', 'false');
  }
}

element('caregiver-toggle').addEventListener('click', () => {
  const open = element('caregiver-panel').hidden === true;

  setCaregiverPanel(open);

  if (open) element('caregiver-close').focus();
});

element('caregiver-close').addEventListener('click', () => {
  setCaregiverPanel(false);

  element('caregiver-toggle').focus();
});

element('eye-help').addEventListener('click', () => {
  const open = element('eye-help-text').hidden === true;

  element('eye-help-text').hidden = !open;

  element('eye-help').setAttribute('aria-expanded', String(open));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !element('caregiver-panel').hidden) {
    setCaregiverPanel(false);

    element('caregiver-toggle').focus();
  }
});

addButton.addEventListener('click', () => {
  activate(addButton);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) speaker.stop();
});

window.addEventListener('pagehide', () => {
  speaker.stop();
});

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    board = raw === null ? defaultBoard() : readSavedBoard(raw);

    storageHealthy = true;

    screen = 'board';

    selected = null;

    page = 0;

    render();

    notify('As frases foram alteradas noutro separador.');
  } catch (error) {
    storageHealthy = false;

    notify(`As frases de outro separador não puderam ser lidas. ${errorMessage(error)}`);
  }
});

render();

if (initialError) notify(initialError);

import './style.css';
import { type AccountSession, getSession, saveBoard } from './account-client';
import { Speaker } from './speech';
import {
  addPhrase,
  type Board,
  defaultBoard,
  MAX_TEXT,
  movePhrase,
  type Phrase,
  replaceSlot,
} from './store';

type Screen = 'board' | 'catalogue' | 'replace' | 'add' | 'sort-slots' | 'sort-catalogue';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) throw new Error('O elemento principal não foi encontrado.');

const app = root;
let board = defaultBoard();
let account: AccountSession | null = null;
let saving = false;
let orderIndex = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

let screen: Screen = 'board';
let page = 0;
let selected: Phrase | null = null;

function mountBoard(): void {
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
          <button id="sort-slots" type="button" class="helper"><strong>Ordenar os quatro botões</strong><span>Escolher a posição das frases</span></button>
          <button id="sort-catalogue" type="button" class="helper"><strong>Ordenar o catálogo</strong><span>Organizar as frases guardadas</span></button>
          <a id="logout" href="/cdn-cgi/access/logout" class="helper"><strong>Terminar sessão</strong><span>Sair do acesso neste dispositivo</span></a>
        </div>
        <p id="eye-help-text" hidden>No iPad: Ajustes -> Acessibilidade -> Rastreamento dos Olhos. Se disponível, configure o Atalho de acessibilidade para acesso pelo botão superior. Esta aplicação não ativa nem desativa o rastreamento.</p>
      </section>
      <div class="footer-bar">
        <div class="caregiver-entry">
          <button id="caregiver-toggle" type="button" class="helper" aria-expanded="false" aria-controls="caregiver-panel">Acompanhante · Opções</button>
          <span id="caregiver-hint">Peça a quem acompanha para aceder às configurações.</span>
        </div>
        <div class="privacy"><span class="release-label"><small class="experimental">EXPERIMENTAL</small><span>v${__APP_VERSION__}</span></span></div>
      </div>
    </footer>
  </div>`;

  wireControls();

  render();
}

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

function notify(message: string): void {
  element('notice').textContent = message;
}

const speaker = new Speaker(notify, (busy) => {
  if (!busy && account) element('spoken').textContent = '';
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

  if (action === 'previous' || action === 'next') {
    button.classList.add('page-navigation');

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    arrow.setAttribute('class', 'page-arrow');

    arrow.setAttribute('aria-hidden', 'true');

    arrow.setAttribute('viewBox', '0 0 24 24');

    arrow.setAttribute('focusable', 'false');

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');

    chevron.setAttribute('points', action === 'previous' ? '16,4 8,12 16,20' : '8,4 16,12 8,20');

    arrow.append(chevron);

    if (action === 'previous') button.prepend(arrow);
    else button.append(arrow);
  }

  if (!options.secondary && screen === 'replace') {
    button.classList.add('replacement-target');
  }

  button.addEventListener('click', () => {
    void activate(button);
  });

  return button;
}

function render(updatedSlot?: number): void {
  const content = element('content');

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
          : screen.startsWith('sort-')
            ? 'Organizar frases · acompanhante'
            : 'Adicionar uma frase';

  element('screen-hint').textContent =
    screen === 'board'
      ? 'Toque numa frase ou use o Controlo ocular do iPad.'
      : screen === 'catalogue'
        ? `Catálogo · página ${page + 1} de ${Math.ceil(board.phrases.length / 4)}`
        : screen === 'replace'
          ? `Escolha um dos quatro botões destacados para colocar: «${selected?.text ?? ''}»`
          : 'Área de escrita para quem acompanha.';

  if (screen === 'catalogue') {
    const pageLabel = document.createElement('strong');

    pageLabel.className = 'page-indicator';

    pageLabel.textContent = `página ${page + 1} de ${Math.ceil(board.phrases.length / 4)}`;

    element('screen-hint').replaceChildren('Catálogo · ', pageLabel);
  }

  if (screen === 'sort-slots' || screen === 'sort-catalogue') {
    renderOrder();

    return;
  }

  if (screen === 'board' || screen === 'replace') {
    board.slots.forEach((id, index) => {
      const button = makeButton(
        phraseFor(id).text,
        screen === 'board' ? `speak:${index}` : `replace:${index}`,
        {
          label:
            screen === 'replace'
              ? `Botão ${index + 1}: ${phraseFor(id).text}. Substituir.`
              : undefined,
        },
      );

      if (screen === 'board' && index === updatedSlot) {
        button.classList.add('updated-target', 'click-feedback');
      }

      grid.append(button);
    });

    if (screen === 'board') {
      controls.append(
        makeButton('Escolher outra frase guardada', 'catalogue', { secondary: true }),
      );

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

async function persist(next: Board): Promise<boolean> {
  if (!account) throw new Error('Inicie sessão para guardar as frases.');

  if (saving) return false;

  saving = true;

  element('shell').inert = true;

  try {
    const saved = await saveBoard(next, account.revision, account.csrf);

    board = saved.board;

    account = { ...account, ...saved };

    notify('');

    return true;
  } catch (error) {
    notify(
      `Não foi possível guardar. Nada foi alterado nesta página. ${errorMessage(error)} Recarregue a página para carregar a versão atual ou voltar a entrar.`,
    );

    return false;
  } finally {
    saving = false;

    element('shell').inert = false;
  }
}

async function activate(button: HTMLButtonElement): Promise<void> {
  if (button.disabled || saving) return;

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

      if (!(await persist(replaceSlot(board, Number(action.slice(8)), selected.id)))) return;

      element('spoken').textContent = `Botão atualizado: «${selected.text}».`;

      screen = 'board';

      selected = null;

      render(Number(action.slice(8)));

      return;
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
    <p>Até ${MAX_TEXT} caracteres. Fica guardada no catálogo da sua conta.</p>
    <label class="position-label" for="phrase-position">Posição no catálogo</label>
    <select id="phrase-position"></select>
    <p>Área para quem acompanha. O Controlo ocular do iPad é gerido nas definições do dispositivo, não nesta aplicação.</p>
    <div class="controls"><button type="submit" class="control-button">Guardar no catálogo</button><button type="button" id="form-back" class="control-button">Cancelar</button></div>`;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    void submitPhrase();
  });

  async function submitPhrase(): Promise<void> {
    try {
      const text = element('new-phrase', HTMLTextAreaElement).value;
      const added = addPhrase(board, text);
      const position = Number(element('phrase-position', HTMLSelectElement).value);
      const next = movePhrase(added, added.phrases.length - 1, position, false);

      if (!(await persist(next))) return;

      screen = 'catalogue';

      page = Math.floor(position / 4);

      notify('Frase guardada. Escolha-a no catálogo para a colocar num botão.');

      render();
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  element('content').append(form);

  const positions = element('phrase-position', HTMLSelectElement);

  for (let index = 0; index <= board.phrases.length; index++) {
    const option = document.createElement('option');

    option.value = String(index);

    option.textContent =
      index === board.phrases.length
        ? 'No fim do catálogo'
        : `Antes de: ${board.phrases[index].text}`;

    positions.append(option);
  }

  positions.value = String(board.phrases.length);

  element('form-back').addEventListener('click', () => {
    screen = 'board';

    render();
  });

  element('new-phrase', HTMLTextAreaElement).focus();
}

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

function wireControls(): void {
  element('sound').addEventListener('click', () => {
    speaker.speak('Olá. Esta é a minha voz.');
  });

  const addButton = element('add', HTMLButtonElement);

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

  addButton.addEventListener('click', () => {
    void activate(addButton);
  });

  for (const mode of ['sort-slots', 'sort-catalogue'] as const) {
    element(mode).addEventListener('click', () => {
      screen = mode;

      orderIndex = 0;

      render();
    });
  }

  element('logout').addEventListener('click', (event) => {
    if (saving) {
      event.preventDefault();

      return;
    }

    speaker.stop();

    account = null;

    board = defaultBoard();

    showHome('A terminar a sessão no Cloudflare Access…');
  });
}

app.addEventListener(
  'click',
  (event) => {
    if (!(event.target instanceof Element) || saving) return;

    const control = event.target.closest('button, a.helper, a.control-button');

    if (!(control instanceof HTMLElement) || control.matches(':disabled')) return;

    control.classList.add('click-feedback');
  },
  { capture: true },
);

app.addEventListener('animationend', (event) => {
  if (event.target instanceof HTMLElement) event.target.classList.remove('click-feedback');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && account && !element('caregiver-panel').hidden) {
    setCaregiverPanel(false);

    element('caregiver-toggle').focus();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) speaker.stop();
});

window.addEventListener('pagehide', () => {
  speaker.stop();
});

function renderOrder(): void {
  const slotsOnly = screen === 'sort-slots';
  const phrases = slotsOnly ? board.slots.map(phraseFor) : board.phrases;
  const panel = document.createElement('section');

  panel.className = 'order-panel';

  panel.innerHTML = `<label for="order-phrase">${slotsOnly ? 'Posição dos quatro botões' : 'Ordem do catálogo'} · acompanhante</label><select id="order-phrase"></select><p id="order-preview"></p><p>Escolha uma frase e mova-a. Cada alteração é guardada na conta.</p><div class="controls three-controls"><button id="order-up" type="button" class="control-button">Mover antes</button><button id="order-down" type="button" class="control-button">Mover depois</button><button id="order-back" type="button" class="control-button">Voltar às frases</button></div>`;

  element('content').append(panel);

  const chooser = element('order-phrase', HTMLSelectElement);

  phrases.forEach((phrase, index) => {
    const option = document.createElement('option');

    option.value = String(index);

    option.textContent = `${index + 1}. ${phrase.text}`;

    chooser.append(option);
  });

  chooser.value = String(orderIndex);

  const update = (): void => {
    element('order-preview').textContent = phrases[orderIndex].text;

    element('order-up', HTMLButtonElement).disabled = orderIndex === 0;

    element('order-down', HTMLButtonElement).disabled = orderIndex === phrases.length - 1;
  };

  chooser.addEventListener('change', () => {
    orderIndex = Number(chooser.value);

    update();
  });

  update();

  const move = async (offset: number): Promise<void> => {
    try {
      if (await persist(movePhrase(board, orderIndex, orderIndex + offset, slotsOnly))) {
        orderIndex += offset;

        render();
      }
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  element('order-up').addEventListener('click', () => {
    void move(-1);
  });

  element('order-down').addEventListener('click', () => {
    void move(1);
  });

  element('order-back').addEventListener('click', () => {
    screen = 'board';

    render();
  });
}

function showHome(message = ''): void {
  app.innerHTML = `<div class="login-shell"><img src="/logo.svg" alt="O meu olhar" width="120" height="84"><h1>O meu olhar</h1><p>Comunicar, uma frase de cada vez.</p><a id="access-login" href="/app" class="control-button">Entrar</a><p id="notice" role="alert"></p><p>Use o seu e-mail autorizado no Cloudflare Access. Para pedir acesso, contacte quem administra a aplicação.</p><small>EXPERIMENTAL · v${__APP_VERSION__}</small></div>`;

  notify(message);
}

try {
  app.innerHTML = '<p role="status">A carregar a sessão…</p>';

  if (location.hash) history.replaceState(null, '', location.pathname);

  account = await getSession();

  if (account) {
    board = account.board;

    history.replaceState(null, '', '/app');

    mountBoard();
  } else showHome();
} catch (error) {
  showHome(`Não foi possível carregar a sessão. ${errorMessage(error)}`);
}

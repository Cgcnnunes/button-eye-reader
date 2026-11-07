import './style.css';
import { contains, Dwell, type Point, type Target } from './dwell';
import { CameraTracker, type TrackingFrame } from './gaze';
import { fitMapping, type Mapping, predict, type Sample, validationAccepted } from './gaze-math';
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
} from './store';

type Screen = 'board' | 'catalogue' | 'replace' | 'add';

type EyeMode = 'off' | 'loading' | 'calibrating' | 'validating' | 'ready';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) throw new Error('O elemento principal não foi encontrado.');

const app = root;
let board = defaultBoard();
let initialError = '';
let storageHealthy = true;

try {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (raw !== null) board = parseBoard(raw);
} catch (error) {
  storageHealthy = false;

  initialError = `Não foi possível ler as frases guardadas. Os dados existentes não serão alterados. ${errorMessage(error)}`;
}

let screen: Screen = 'board';
let page = 0;
let selected: Phrase | null = null;
let eyeMode: EyeMode = 'off';
let mapping: Mapping | null = null;
let smooth: Point | null = null;
let lastValid = 0;
let samples: Sample[] = [];
let stageSamples: Sample[] = [];
let stage = 0;
let stageSince = 0;
let stageDeadline = 0;
let stageInvalid = 0;
let validationErrors: Point[][] = [];
let gazeSession = 0;
let progressId: string | null = null;
let trackingLabel = 'Olhar desligado';
const dwell = new Dwell();
const calibrationPoints: Point[] = [
  { x: 0.15, y: 0.18 },
  { x: 0.5, y: 0.18 },
  { x: 0.85, y: 0.18 },
  { x: 0.85, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.15, y: 0.5 },
  { x: 0.15, y: 0.82 },
  { x: 0.5, y: 0.82 },
  { x: 0.85, y: 0.82 },
];
const validationPoints: Point[] = [
  { x: 0.25, y: 0.3 },
  { x: 0.75, y: 0.3 },
  { x: 0.75, y: 0.7 },
  { x: 0.25, y: 0.7 },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

app.innerHTML = `
  <div id="shell" class="shell">
    <header>
      <div class="brand"><span class="brand-mark" aria-hidden="true">O</span><div><h1>O meu olhar</h1><p>Uma frase de cada vez</p></div></div>
      <div class="tracking"><span id="tracking-dot" aria-hidden="true"></span><span id="tracking">Olhar desligado</span><small>EXPERIMENTAL</small></div>
    </header>
    <section class="guidance" aria-label="Instruções"><div><h2 id="screen-title"></h2><p id="screen-hint"></p></div><span class="dwell-label">Olhar durante <strong>2 segundos</strong></span></section>
    <main id="content"></main>
    <div class="feedback"><p id="spoken" role="status" aria-live="polite">Toque numa frase para falar.</p><p id="notice" role="alert"></p></div>
    <footer>
      <span>Para quem acompanha:</span>
      <button id="sound" class="helper">Testar som</button>
      <button id="eye-toggle" class="helper">Ativar olhar</button>
      <button id="eye-stop" class="helper" hidden>Desligar câmara</button>
      <span class="privacy">Câmara e frases ficam neste dispositivo. · v${__APP_VERSION__}</span>
    </footer>
  </div>
  <div id="gaze-cursor" aria-hidden="true" hidden></div>
  <div id="calibration" class="calibration" hidden role="dialog" aria-modal="true" aria-labelledby="calibration-title">
    <div class="calibration-info"><h2 id="calibration-title">Siga o círculo com os olhos</h2><p id="calibration-info"></p></div>
    <div id="calibration-target" aria-hidden="true"><span></span></div>
    <button id="cancel-calibration" class="helper">Cancelar</button>
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
const overlay = element('calibration');
const cursor = element('gaze-cursor');

function notify(message: string): void {
  notice.textContent = message;
}

const speaker = new Speaker(notify, (busy) => {
  dwell.reset();

  clearProgress();

  if (!busy) element('spoken').textContent = 'Pronto para a próxima frase.';
});

const tracker = new CameraTracker(handleFrame, (error) => {
  stopEyes();

  notify(`O olhar foi desligado. ${errorMessage(error)}`);
});

function phraseFor(id: string): Phrase {
  const phrase = board.phrases.find((item) => item.id === id);

  if (!phrase) throw new Error('A frase não foi encontrada.');

  return phrase;
}

function makeButton(
  text: string,
  action: string,
  options: { disabled?: boolean; gaze?: boolean; label?: string; secondary?: boolean } = {},
): HTMLButtonElement {
  const button = document.createElement('button');

  button.type = 'button';

  button.className = options.secondary ? 'control-button' : 'phrase-button';

  if (!options.secondary && text.length > 45) button.classList.add('long-phrase');
  else if (!options.secondary && text.length > 24) button.classList.add('medium-phrase');

  button.dataset.action = action;

  if (options.gaze !== false) button.dataset.gaze = action;

  button.disabled = options.disabled ?? false;

  if (options.label) button.setAttribute('aria-label', options.label);

  const label = document.createElement('span');

  label.className = 'button-text';

  label.textContent = text;

  button.append(label);

  if (!options.secondary) {
    const hint = document.createElement('small');

    hint.textContent =
      screen === 'board'
        ? 'Falar'
        : screen === 'replace'
          ? 'Substituir este botão'
          : 'Escolher frase';

    button.append(hint);
  }

  button.addEventListener('click', () => {
    activate(button, false);
  });

  return button;
}

function clearProgress(): void {
  if (progressId) {
    content.querySelectorAll<HTMLButtonElement>('[data-gaze]').forEach((button) => {
      button.classList.remove('dwelling');

      button.style.removeProperty('--progress');
    });
  }

  progressId = null;
}

function render(): void {
  dwell.reset();

  clearProgress();

  content.replaceChildren();

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
      ? 'Olhe para uma frase ou toque no botão.'
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

      const add = makeButton('Adicionar frase', 'add', { gaze: false, secondary: true });

      add.classList.add('caregiver');

      const small = document.createElement('small');

      small.textContent = 'Para quem acompanha';

      add.append(small);

      controls.append(add);
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

function activate(button: HTMLButtonElement, fromGaze: boolean): void {
  if (button.disabled || (fromGaze && (eyeMode !== 'ready' || speaker.speaking))) return;

  const rect = button.getBoundingClientRect();

  dwell.block(rect);

  clearProgress();

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
    } else if (action === 'add') {
      stopEyes();

      screen = 'add';
    }

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
    <p>O olhar está desligado nesta área. Ative-o novamente depois de escrever.</p>
    <div class="controls"><button type="submit" class="control-button">Guardar no catálogo</button><button type="button" id="form-back" class="control-button">Cancelar</button></div>`;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    try {
      const text = element('new-phrase', HTMLTextAreaElement).value;
      const next = addPhrase(board, text);

      if (!persist(next)) return;

      page = Math.floor((board.phrases.length - 1) / 4);

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

function setTracking(text: string): void {
  if (text !== trackingLabel) {
    trackingLabel = text;

    element('tracking').textContent = text;
  }

  element('tracking-dot').classList.toggle('ready', eyeMode === 'ready' && text === 'Olhar ativo');
}

function stopEyes(): void {
  gazeSession++;

  tracker.stop();

  eyeMode = 'off';

  mapping = null;

  smooth = null;

  dwell.reset();

  clearProgress();

  cursor.hidden = true;

  overlay.hidden = true;

  element('eye-stop').hidden = true;

  element('eye-toggle', HTMLButtonElement).disabled = false;

  element('eye-toggle').textContent = 'Ativar olhar';

  element('shell').inert = false;

  element('calibration-target').style.removeProperty('--progress');

  setTracking('Olhar desligado');
}

async function startEyes(): Promise<void> {
  if (screen === 'add') {
    notify('Termine a escrita antes de ativar o olhar.');

    return;
  }

  stopEyes();

  const session = gazeSession;

  eyeMode = 'loading';

  element('eye-toggle', HTMLButtonElement).disabled = true;

  element('eye-stop').hidden = false;

  setTracking('A preparar a câmara…');

  notify(
    'Use um suporte fixo, luz uniforme e o iPad ao nível dos olhos. Só uma pessoa deve estar na imagem. O olhar é experimental.',
  );

  // Starting speech here is a direct touch gesture, required by some iPad audio policies.
  speaker.speak('Vamos preparar o olhar.');

  try {
    await tracker.start();

    if (session !== gazeSession) return;

    samples = [];

    stageSamples = [];

    validationErrors = [];

    stage = 0;

    stageInvalid = 0;

    stageSince = performance.now();

    stageDeadline = stageSince + 15000;

    eyeMode = 'calibrating';

    overlay.hidden = false;

    element('shell').inert = true;

    element('cancel-calibration').focus();

    setTracking('A calibrar o olhar');

    showStage();
  } catch (error) {
    if (session !== gazeSession) return;

    stopEyes();

    notify(
      `Não foi possível ativar a câmara. ${errorMessage(error)} Pode continuar a usar os botões por toque.`,
    );
  }
}

function showStage(): void {
  const points = eyeMode === 'calibrating' ? calibrationPoints : validationPoints;
  const target = element('calibration-target');

  target.style.left = `${points[stage].x * 100}%`;

  target.style.top = `${points[stage].y * 100}%`;

  target.style.setProperty('--progress', '0');

  element('calibration-title').textContent =
    eyeMode === 'calibrating' ? 'Siga o círculo com os olhos' : 'Vamos confirmar o olhar';

  element('calibration-info').textContent =
    `${eyeMode === 'calibrating' ? 'Calibração' : 'Verificação'} ${stage + 1}/${points.length} · Olhe para o centro do círculo. Não precisa de tocar.`;
}

function calibrationFrame({ features, time }: TrackingFrame): void {
  if (time > stageDeadline) {
    stopEyes();

    notify(
      'Não foi possível ver os olhos de forma estável. Ajuste a luz e a posição e tente novamente.',
    );

    return;
  }

  if (!features) {
    stageInvalid++;

    element('calibration-info').textContent =
      'Não vejo os olhos com segurança. Mantenha-os abertos e deixe só uma pessoa na imagem.';

    return;
  }

  const elapsed = time - stageSince;

  element('calibration-target').style.setProperty(
    '--progress',
    String(Math.min(1, elapsed / 3000)),
  );

  const points = eyeMode === 'calibrating' ? calibrationPoints : validationPoints;

  if (elapsed >= 1200) stageSamples.push({ features, point: points[stage] });

  if (elapsed < 3000) return;

  if (stageSamples.length < 12 || stageInvalid > 12) {
    stageSamples = [];

    stageInvalid = 0;

    stageSince = time;

    showStage();

    element('calibration-info').textContent =
      'Vamos repetir este ponto. Olhe para o centro do círculo.';

    return;
  }

  if (eyeMode === 'calibrating') {
    samples.push(...stageSamples);
  } else {
    if (!mapping) throw new Error('A calibração não foi encontrada.');

    const calibrated = mapping;
    const predictions = stageSamples.map((s) => predict(calibrated, s.features));

    if (predictions.some((p) => p === null)) {
      stopEyes();

      notify('O olhar saiu da posição calibrada. Fixe o iPad e volte a calibrar.');

      return;
    }

    const point = points[stage];

    // Use per-frame errors, not just an average that could hide unstable tracking.
    validationErrors.push(
      predictions.flatMap((p) =>
        p ? [{ x: Math.abs(p.x - point.x), y: Math.abs(p.y - point.y) }] : [],
      ),
    );
  }

  stage++;

  stageSamples = [];

  stageInvalid = 0;

  stageSince = time;

  stageDeadline = time + 15000;

  if (stage < points.length) {
    showStage();

    return;
  }

  if (eyeMode === 'calibrating') {
    mapping = fitMapping(samples);

    stage = 0;

    eyeMode = 'validating';

    showStage();

    return;
  }

  if (!validationErrors.every(validationAccepted)) {
    stopEyes();

    notify(
      'A verificação não foi suficientemente precisa (90% dos pontos devem ficar a menos de 12% do ecrã em cada direção). O olhar não foi ativado. Use o toque ou tente calibrar novamente.',
    );

    return;
  }

  eyeMode = 'ready';

  overlay.hidden = true;

  element('shell').inert = false;

  element('eye-toggle', HTMLButtonElement).disabled = false;

  element('eye-toggle').textContent = 'Recalibrar';

  smooth = null;

  dwell.reset();

  // Require looking away from the final calibration target before any selection.
  const final = validationPoints[validationPoints.length - 1];

  dwell.block({
    bottom: (final.y + 0.15) * innerHeight,
    left: (final.x - 0.15) * innerWidth,
    right: (final.x + 0.15) * innerWidth,
    top: (final.y - 0.15) * innerHeight,
  });

  setTracking('Olhar ativo');

  notify(
    'Olhar experimental ativo. Teste todas as frases e a troca no catálogo com acompanhamento. Se houver erros, desligue o olhar.',
  );
}

function handleFrame(frame: TrackingFrame): void {
  if (eyeMode === 'calibrating' || eyeMode === 'validating') {
    calibrationFrame(frame);

    return;
  }

  if (eyeMode !== 'ready' || !mapping) return;

  const raw = frame.features ? predict(mapping, frame.features) : null;
  const valid = raw && raw.x >= 0 && raw.x <= 1 && raw.y >= 0 && raw.y <= 1;

  if (!valid || speaker.speaking) {
    smooth = null;

    dwell.update(null, [], frame.time);

    clearProgress();

    cursor.hidden = true;

    setTracking(speaker.speaking ? 'A falar · olhar em pausa' : 'Olhos não detetados · em pausa');

    return;
  }

  const pixel = { x: raw.x * innerWidth, y: raw.y * innerHeight };

  if (frame.time - lastValid > 350) smooth = null;

  lastValid = frame.time;

  smooth = smooth
    ? { x: smooth.x * 0.55 + pixel.x * 0.45, y: smooth.y * 0.55 + pixel.y * 0.45 }
    : pixel;

  setTracking('Olhar ativo');

  cursor.hidden = false;

  cursor.style.left = `${smooth.x}px`;

  cursor.style.top = `${smooth.y}px`;

  const buttons = [
    ...content.querySelectorAll<HTMLButtonElement>('button[data-gaze]:not(:disabled)'),
  ];
  const targets: Target[] = buttons.map((button) => {
    const id = button.dataset.gaze;

    if (!id) {
      throw new Error('Um botão não tem identificador de olhar.');
    }

    return { id, rect: button.getBoundingClientRect() };
  });
  // Both raw and smoothed positions must be within the same button; smoothing alone can linger after looking away.
  const safeTargets = targets.filter((target) => contains(target.rect, pixel, 16));
  const result = dwell.update(smooth, safeTargets, frame.time);

  clearProgress();

  if (result.id) {
    const button = buttons.find((item) => item.dataset.gaze === result.id);

    if (button) {
      progressId = result.id;

      button.classList.add('dwelling');

      button.style.setProperty('--progress', String(result.progress));

      if (result.fire) activate(button, true);
    }
  }
}

element('sound').addEventListener('click', () => {
  speaker.speak('Olá. Esta é a minha voz.');
});

element('eye-toggle').addEventListener('click', () => {
  void startEyes();
});

element('eye-stop').addEventListener('click', stopEyes);

element('cancel-calibration').addEventListener('click', () => {
  stopEyes();

  element('eye-toggle').focus();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && eyeMode !== 'off') stopEyes();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const wasActive = eyeMode !== 'off';

    stopEyes();

    speaker.stop();

    if (wasActive)
      notify('O olhar foi desligado porque saiu da aplicação. Ative-o e calibre novamente.');
  }
});

window.addEventListener('pagehide', () => {
  stopEyes();

  speaker.stop();
});

window.addEventListener('resize', () => {
  if (eyeMode !== 'off') {
    stopEyes();

    notify('O tamanho ou a orientação do ecrã mudou. Ative o olhar e calibre novamente.');
  }
});

window.addEventListener(
  'scroll',
  () => {
    if (eyeMode !== 'off') {
      stopEyes();

      notify('O ecrã deslocou-se. Volte à posição inicial e calibre novamente.');
    }
  },
  { passive: true },
);

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;

  stopEyes();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    board = raw === null ? defaultBoard() : parseBoard(raw);

    storageHealthy = true;

    screen = 'board';

    selected = null;

    page = 0;

    render();

    notify('As frases foram alteradas noutro separador. O olhar foi desligado.');
  } catch (error) {
    storageHealthy = false;

    notify(`As frases de outro separador não puderam ser lidas. ${errorMessage(error)}`);
  }
});

render();

if (initialError) notify(initialError);

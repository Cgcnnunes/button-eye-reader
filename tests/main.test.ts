// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Board, defaultBoard, STORAGE_KEY } from '../src/store';

const mocks = vi.hoisted(() => ({
  changed: vi.fn<(busy: boolean) => void>(),
  getSession: vi.fn(),
  notify: vi.fn<(message: string) => void>(),
  saveBoard: vi.fn(),
  speak: vi.fn<(text: string) => void>(),
  speaking: false,
  stop: vi.fn<() => void>(),
}));

vi.mock('../src/account-client', () => ({
  getSession: mocks.getSession,
  saveBoard: mocks.saveBoard,
}));

vi.mock('../src/speech', () => ({
  Speaker: class {
    get speaking(): boolean {
      return mocks.speaking;
    }

    constructor(notify: (message: string) => void, changed: (busy: boolean) => void) {
      mocks.notify.mockImplementation(notify);

      mocks.changed.mockImplementation(changed);
    }

    speak(text: string): void {
      mocks.speak(text);
    }
    stop(): void {
      mocks.stop();

      mocks.changed(false);
    }
  },
}));

interface Listener {
  listener: EventListenerOrEventListenerObject;
  name: string;
  options?: AddEventListenerOptions | boolean;
}

let documentListeners: Listener[] = [];
let windowListeners: Listener[] = [];

function button(action: string): HTMLButtonElement {
  const found =
    document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) ??
    document.getElementById(action);

  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing test button ${action}`);

  return found;
}

function text(id: string): string {
  return document.getElementById(id)?.textContent ?? '';
}

async function load(): Promise<void> {
  await import('../src/main');
}

function submit(value: string): void {
  const input = document.querySelector('textarea');

  if (!input) throw new Error('Missing textarea');

  input.value = value;

  document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('standard accessible phrase board', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.clearAllMocks();

    mocks.speaking = false;

    history.replaceState(null, '', '/');

    mocks.getSession.mockResolvedValue({
      board: defaultBoard(),
      csrf: 'csrf',
      revision: 1,
      username: 'helper',
    });

    mocks.saveBoard.mockImplementation((board: Board, revision: number) =>
      Promise.resolve({ board, revision: revision + 1 }),
    );

    document.body.innerHTML = '<div id="app"></div>';

    localStorage.clear();

    documentListeners = [];

    windowListeners = [];

    const documentAdd = document.addEventListener.bind(document);
    const windowAdd = window.addEventListener.bind(window);

    vi.spyOn(document, 'addEventListener').mockImplementation((name, listener, options) => {
      documentListeners.push({ listener, name, options });

      documentAdd(name, listener, options);
    });

    vi.spyOn(window, 'addEventListener').mockImplementation((name, listener, options) => {
      windowListeners.push({ listener, name, options });

      windowAdd(name, listener, options);
    });
  });

  afterEach(() => {
    for (const listener of documentListeners) {
      document.removeEventListener(listener.name, listener.listener, listener.options);
    }

    for (const listener of windowListeners) {
      window.removeEventListener(listener.name, listener.listener, listener.options);
    }

    vi.restoreAllMocks();

    vi.unstubAllGlobals();
  });

  it('has four native speaking buttons and no camera, calibration, diagnostics or custom gaze hook', async () => {
    const camera = vi.fn();

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: camera } });

    await load();

    expect(document.querySelectorAll('.phrase-button')).toHaveLength(4);

    expect(
      document.querySelector('video, canvas, [data-gaze], #calibration, #diagnostics, #eye-toggle'),
    ).toBeNull();

    expect(camera).not.toHaveBeenCalled();

    expect(readFileSync('index.html', 'utf8')).not.toContain('data-eye-debug');

    expect(text('screen-hint')).toContain('Controlo ocular do iPad');

    expect(button('add').closest('[role="group"]')?.getAttribute('aria-labelledby')).toBe(
      'caregiver-label',
    );

    expect(document.querySelector('footer')?.textContent).toContain('v0.1.0-test');

    for (let index = 0; index < 4; index++) {
      expect(button(`speak:${index}`).type).toBe('button');

      button(`speak:${index}`).click();

      const board = defaultBoard();

      expect(mocks.speak).toHaveBeenLastCalledWith(
        board.phrases.find((phrase) => phrase.id === board.slots[index])?.text,
      );
    }
  });

  it('keeps caregiver helpers together outside the speaking area and starts with no idle prompt', async () => {
    await load();

    expect(text('spoken')).toBe('');

    expect(document.body.textContent).not.toContain('Toque numa frase para falar.');

    expect(document.querySelectorAll('#add')).toHaveLength(1);

    expect(button('add').parentElement).toBe(button('sound').parentElement);

    expect(button('sound').nextElementSibling).toBe(button('add'));

    expect(button('add').className).toBe(button('sound').className);

    expect(button('add').closest('footer')).not.toBeNull();

    expect(button('add').closest('main')).toBeNull();

    expect(document.querySelectorAll('main .control-button')).toHaveLength(1);

    button('catalogue').click();

    expect(button('add').hidden).toBe(true);

    button('board').click();

    expect(button('add').hidden).toBe(false);

    button('add').click();

    expect(document.querySelector('form')).not.toBeNull();

    expect(button('add').hidden).toBe(true);

    button('form-back').click();

    expect(button('add').hidden).toBe(false);
  });

  it('expands caregiver options, shows system instructions and restores focus on closing', async () => {
    await load();

    expect(document.getElementById('caregiver-panel')?.hidden).toBe(true);

    button('caregiver-toggle').click();

    expect(button('caregiver-toggle').getAttribute('aria-expanded')).toBe('true');

    expect(document.getElementById('caregiver-hint')?.hidden).toBe(true);

    expect(document.activeElement).toBe(button('caregiver-close'));

    button('sound').click();

    expect(mocks.speak).toHaveBeenLastCalledWith('Olá. Esta é a minha voz.');

    button('eye-help').click();

    expect(text('eye-help-text')).toContain('Ajustes -> Acessibilidade -> Rastreamento dos Olhos');

    expect(document.getElementById('eye-help-text')?.hidden).toBe(false);

    button('eye-help').click();

    expect(document.getElementById('eye-help-text')?.hidden).toBe(true);

    button('caregiver-close').click();

    expect(document.activeElement).toBe(button('caregiver-toggle'));

    button('caregiver-toggle').click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(button('caregiver-toggle').getAttribute('aria-expanded')).toBe('false');

    button('caregiver-toggle').click();

    button('add').click();

    expect(document.querySelector('form')).not.toBeNull();

    expect(document.getElementById('caregiver-panel')?.hidden).toBe(true);
  });

  it('does not import browser phrases into a cloud account', async () => {
    const old = defaultBoard();

    old.slots = ['template-0', 'template-1', 'template-2', 'template-3'];

    const raw = JSON.stringify(old);

    localStorage.setItem(STORAGE_KEY, raw);

    await load();

    expect(button('speak:2').textContent).toContain('casa de banho');

    expect(button('speak:3').textContent).toContain('Tenho dores');

    expect(mocks.saveBoard).not.toHaveBeenCalled();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('supports pointer-style click activation without app calibration or dwell timers', async () => {
    await load();

    mocks.speaking = true;

    button('speak:2').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mocks.speak).toHaveBeenCalledWith('Preciso de ir à casa de banho');

    expect(text('spoken')).toContain('A dizer:');

    mocks.changed(true);

    expect(text('spoken')).toContain('A dizer:');

    mocks.changed(false);

    expect(text('spoken')).toBe('');

    button('sound').click();

    expect(mocks.speak).toHaveBeenLastCalledWith('Olá. Esta é a minha voz.');

    mocks.notify('Falha de voz');

    expect(text('notice')).toBe('Falha de voz');
  });

  it('pages the catalogue, cancels changes and persists a replacement', async () => {
    await load();

    expect(button('catalogue').textContent).toBe('Escolher outra frase guardada');

    button('catalogue').click();

    expect(document.querySelector('.page-indicator')?.textContent).toBe('página 1 de 7');

    expect(button('previous').querySelector('.page-arrow polyline')?.getAttribute('points')).toBe(
      '16,4 8,12 16,20',
    );

    expect(button('next').querySelector('.page-arrow polyline')?.getAttribute('points')).toBe(
      '8,4 16,12 8,20',
    );

    expect(button('previous').querySelector('.page-arrow')?.getAttribute('aria-hidden')).toBe(
      'true',
    );

    expect(button('previous').disabled).toBe(true);

    button('previous').click();

    button('next').click();

    expect(document.querySelector('.page-indicator')?.textContent).toBe('página 2 de 7');

    button('previous').click();

    button('choose:template-1').click();

    expect(button('replace:0').getAttribute('aria-label')).toContain('Substituir');

    button('catalogue').click();

    button('choose:template-0').click();

    button('board').click();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    button('catalogue').click();

    button('next').click();

    button('choose:template-4').click();

    mocks.notify('Aviso anterior');

    button('replace:0').click();

    await vi.waitFor(() => {
      expect(text('screen-title')).toBe('O que quer dizer?');
    });

    expect(mocks.saveBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: ['template-4', 'template-1', 'template-12', 'template-28'],
      }),
      1,
      'csrf',
    );

    expect(text('spoken')).toContain('Botão atualizado');

    expect(text('notice')).toBe('');

    expect(button('speak:0').classList.contains('updated-target')).toBe(true);

    expect(document.querySelectorAll('.updated-target')).toHaveLength(1);

    button('catalogue').click();

    while (!button('next').disabled) button('next').click();

    expect(text('screen-hint')).toContain('página 7 de 7');

    button('next').click();

    expect(text('screen-hint')).toContain('página 7 de 7');
  });

  it('keeps guidance without a logo in the header and experimental beside the footer version', async () => {
    await load();

    expect(document.querySelector('header #screen-title')?.tagName).toBe('H1');

    expect(document.querySelector('header #screen-hint')).not.toBeNull();

    expect(document.querySelector('header img')).toBeNull();

    expect(document.querySelector('header .experimental')).toBeNull();

    expect(document.querySelector('footer .release-label')?.textContent).toContain('EXPERIMENTAL');

    expect(document.querySelector('footer .release-label')?.textContent).toContain('v0.1.0-test');

    expect(document.body.textContent).not.toContain('Uma frase de cada vez');

    expect(document.querySelector('footer')?.textContent).not.toContain(
      'Frases e posições guardadas na sua conta.',
    );
  });

  it('shows only centered phrase text and highlights all four replacement targets', async () => {
    await load();

    for (const target of document.querySelectorAll('.phrase-button')) {
      expect(target.querySelector('small')).toBeNull();

      expect(target.children).toHaveLength(1);

      expect(target.textContent).toBe(target.querySelector('.button-text')?.textContent);
    }

    button('catalogue').click();

    expect(document.querySelector('.phrase-button small')).toBeNull();

    button('choose:template-1').click();

    expect(text('screen-hint')).toContain('quatro botões destacados');

    expect(document.querySelectorAll('.replacement-target')).toHaveLength(4);

    for (let index = 0; index < 4; index++) {
      const target = button(`replace:${index}`);

      expect(target.children).toHaveLength(1);

      expect(target.textContent).toBe(target.querySelector('.button-text')?.textContent);

      expect(target.getAttribute('aria-label')).toContain(`Botão ${index + 1}:`);

      expect(target.getAttribute('aria-label')).toContain('Substituir');
    }

    expect(document.querySelector('main')?.textContent).not.toContain('Substituir');

    button('board').click();

    expect(document.querySelector('.replacement-target, .updated-target')).toBeNull();
  });

  it('provides click feedback for standard activation without moving or delaying targets', async () => {
    await load();

    const target = button('speak:0');

    target.querySelector('.button-text')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(target.classList.contains('click-feedback')).toBe(true);

    expect(mocks.speak).toHaveBeenCalledWith('Sim');

    target.dispatchEvent(new Event('animationend', { bubbles: true }));

    expect(target.classList.contains('click-feedback')).toBe(false);

    target.click();

    expect(target.classList.contains('click-feedback')).toBe(true);

    expect(mocks.speak).toHaveBeenCalledTimes(2);

    button('caregiver-toggle').click();

    expect(button('caregiver-toggle').classList.contains('click-feedback')).toBe(true);

    button('catalogue').click();

    const previous = button('previous');

    previous.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(previous.classList.contains('click-feedback')).toBe(false);

    document.getElementById('screen-title')?.click();

    expect(document.querySelector('#screen-title.click-feedback')).toBeNull();
  });

  it('preserves cloud ordering without reapplying the template migration', async () => {
    const old = defaultBoard();

    old.phrases = old.phrases.filter((phrase) => phrase.id !== 'template-28');

    old.slots = ['template-0', 'template-1', 'template-2', 'template-3'];

    const raw = JSON.stringify(old);

    mocks.getSession.mockResolvedValue({
      board: old,
      csrf: 'csrf',
      revision: 2,
      username: 'helper',
    });

    await load();

    expect(button('speak:2').textContent).toContain('Quero água');

    expect(button('speak:3').textContent).toContain('Preciso de ajuda');

    expect(mocks.saveBoard).not.toHaveBeenCalled();

    expect(JSON.stringify(old)).toBe(raw);
  });

  it('keeps writing caregiver-labelled and does not claim to disable system Eye Tracking', async () => {
    await load();

    button('add').click();

    expect(document.activeElement?.id).toBe('new-phrase');

    expect(text('screen-hint')).toContain('quem acompanha');

    expect(document.querySelector('form')?.textContent).toContain('não nesta aplicação');

    expect(document.querySelector('form')?.textContent).not.toContain('olhar está desligado');

    submit('');

    expect(text('notice')).not.toBe('');

    submit('SIM');

    expect(text('notice')).toContain('já existe');

    submit('<img src=x onerror=alert(1)>');

    await vi.waitFor(() => {
      expect(text('notice')).toContain('Frase guardada');
    });

    expect(document.querySelector('main img')).toBeNull();

    button('board').click();

    button('add').click();

    button('form-back').click();

    expect(text('screen-title')).toBe('O que quer dizer?');
  });

  it('renders medium and long saved phrases with literal text', async () => {
    const board = defaultBoard();

    board.phrases[0].text = 'Uma frase com trinta caracteres';

    board.phrases[1].text =
      'Uma frase longa com muitos caracteres para verificar a apresentação sem alterar o conteúdo.';

    mocks.getSession.mockResolvedValue({ board, csrf: 'csrf', revision: 1, username: 'helper' });

    await load();

    expect(button('speak:0').classList.contains('medium-phrase')).toBe(true);

    expect(button('speak:1').classList.contains('long-phrase')).toBe(true);
  });

  it('reports session bootstrap errors and allows login retry', async () => {
    mocks.getSession.mockRejectedValue(new Error('Offline'));

    await load();

    expect(text('notice')).toContain('Offline');

    expect(document.querySelector('#access-login')).not.toBeNull();
  });

  it('reports save conflicts without claiming a successful replacement or addition', async () => {
    await load();

    mocks.saveBoard.mockRejectedValue(new Error('Conflito: outra página guardou alterações.'));

    button('catalogue').click();

    button('choose:template-1').click();

    button('replace:0').click();

    await vi.waitFor(() => {
      expect(text('notice')).toContain('Nada foi alterado');
    });

    expect(text('screen-title')).toBe('Qual botão quer mudar?');

    expect(document.querySelectorAll('.replacement-target')).toHaveLength(4);

    expect(document.querySelector('.updated-target')).toBeNull();

    button('board').click();

    button('add').click();

    submit('Uma frase nova');

    await vi.waitFor(() => {
      expect(mocks.saveBoard).toHaveBeenCalledTimes(2);
    });

    expect(document.querySelector('form')).not.toBeNull();

    expect(text('notice')).toContain('Nada foi alterado');
  });

  it('does not treat cross-tab local storage changes as cloud preferences', async () => {
    await load();

    button('catalogue').click();

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));

    expect(text('screen-title')).toBe('Escolha uma frase');

    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultBoard()));

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(text('screen-title')).toBe('Escolha uma frase');

    localStorage.removeItem(STORAGE_KEY);

    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(document.querySelectorAll('.phrase-button')).toHaveLength(4);

    localStorage.setItem(STORAGE_KEY, '{bad');

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(text('notice')).toBe('');
  });

  it('stops speech on hiding or leaving, without resetting the board on viewport changes', async () => {
    await load();

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.stop).not.toHaveBeenCalled();

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.stop).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));

    expect(mocks.stop).toHaveBeenCalledTimes(2);

    button('catalogue').click();

    window.dispatchEvent(new Event('resize'));

    window.dispatchEvent(new Event('scroll'));

    expect(text('screen-title')).toBe('Escolha uma frase');
  });

  it('reports invalid DOM actions rather than claiming speech or storage success', async () => {
    await load();

    button('speak:0').dataset.action = 'speak:99';

    button('speak:99').click();

    expect(text('notice')).toContain('não foi encontrada');

    button('catalogue').dataset.action = 'replace:0';

    button('replace:0').click();

    expect(text('notice')).toContain('Escolha primeiro');
  });

  it('fails explicitly if the application root is missing', async () => {
    document.body.innerHTML = '';

    await expect(load()).rejects.toThrow('elemento principal');
  });

  it('reports missing or wrongly typed form inputs', async () => {
    await load();

    button('add').click();

    document.getElementById('new-phrase')?.remove();

    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(text('notice')).toContain('Elemento em falta');

    const input = document.createElement('input');

    input.id = 'new-phrase';

    document.querySelector('form')?.append(input);

    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(text('notice')).toContain('tipo incorreto');
  });

  it('shows an Access entry link and logo for an anonymous session, never password fields', async () => {
    mocks.getSession.mockResolvedValue(null);

    await load();

    expect(document.querySelector('img')?.getAttribute('src')).toBe('/logo.svg');

    expect(document.querySelector('#access-login')?.getAttribute('href')).toBe('/app');

    expect(document.querySelector('input,form')).toBeNull();

    expect(document.querySelectorAll('.phrase-button')).toHaveLength(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('clears private board and speech before navigating to managed Access logout', async () => {
    await load();

    const link = document.querySelector<HTMLAnchorElement>('#logout');

    if (!link) throw new Error('Missing logout link');

    expect(link.getAttribute('href')).toBe('/cdn-cgi/access/logout');

    link.dispatchEvent(new Event('click', { cancelable: true }));

    expect(mocks.stop).toHaveBeenCalled();

    expect(document.querySelectorAll('.phrase-button')).toHaveLength(0);

    expect(text('notice')).toContain('Cloudflare Access');
  });

  it('removes obsolete invitation fragments and uses only the Access session', async () => {
    history.replaceState(null, '', '/#setup=single-use-token');

    await load();

    expect(mocks.getSession).toHaveBeenCalledTimes(1);

    expect(location.hash).toBe('');

    expect(document.querySelectorAll('.phrase-button')).toHaveLength(4);

    expect(document.querySelector('input[type=password]')).toBeNull();
  });

  it('lets the caregiver sort slots and catalogue independently and insert a phrase at a chosen position', async () => {
    await load();

    button('sort-slots').click();

    expect(button('order-up').disabled).toBe(true);

    button('order-down').click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#order-phrase')?.value).toBe('1');
    });

    expect(mocks.saveBoard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slots: ['template-1', 'template-0', 'template-12', 'template-28'],
      }),
      1,
      'csrf',
    );

    button('order-up').click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#order-phrase')?.value).toBe('0');
    });

    button('order-back').click();

    button('sort-catalogue').click();

    const chooser = document.querySelector<HTMLSelectElement>('#order-phrase');

    if (!chooser) throw new Error('Missing ordering chooser');

    chooser.value = '25';

    chooser.dispatchEvent(new Event('change'));

    expect(button('order-down').disabled).toBe(true);

    button('order-up').click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#order-phrase')?.value).toBe('24');
    });

    button('order-back').click();

    button('add').click();

    const position = document.querySelector<HTMLSelectElement>('#phrase-position');

    if (!position) throw new Error('Missing phrase position');

    position.value = '0';

    submit('Uma frase nova');

    await vi.waitFor(() => {
      expect(text('screen-title')).toBe('Escolha uma frase');
    });

    expect(document.querySelector('.phrase-button')?.textContent).toBe('Uma frase nova');
  });

  it('locks the board and caregiver navigation while saving, preventing duplicate changes and logout races', async () => {
    await load();

    let complete: ((value: { board: Board; revision: number }) => void) | undefined;

    mocks.saveBoard.mockImplementation(
      () =>
        new Promise<{ board: Board; revision: number }>((resolve) => {
          complete = resolve;
        }),
    );

    button('sort-slots').click();

    button('order-down').click();

    button('order-down').click();

    const logout = document.getElementById('logout');

    if (!logout) throw new Error('Missing logout link');

    const event = new Event('click', { cancelable: true });

    logout.dispatchEvent(event);

    expect(mocks.saveBoard).toHaveBeenCalledTimes(1);

    expect(event.defaultPrevented).toBe(true);

    expect(document.getElementById('shell')?.inert).toBe(true);

    if (!complete) throw new Error('Missing pending save');

    complete({ board: defaultBoard(), revision: 1 });

    await vi.waitFor(() => {
      expect(document.getElementById('shell')?.inert).toBe(false);
    });
  });

  it('keeps ordering controls and local board unchanged if cloud saving fails', async () => {
    await load();

    mocks.saveBoard.mockRejectedValue(new Error('Offline'));

    button('sort-slots').click();

    button('order-down').click();

    await vi.waitFor(() => {
      expect(text('notice')).toContain('Offline');
    });

    expect(document.querySelector<HTMLSelectElement>('#order-phrase')?.value).toBe('0');
  });
});

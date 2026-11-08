// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBoard, parseBoard, STORAGE_KEY } from '../src/store';

const mocks = vi.hoisted(() => ({
  changed: vi.fn<(busy: boolean) => void>(),
  notify: vi.fn<(message: string) => void>(),
  speak: vi.fn<(text: string) => void>(),
  speaking: false,
  stop: vi.fn<() => void>(),
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

  it('preserves the loaded saved board and reports a startup upgrade write failure', async () => {
    const old = defaultBoard();

    old.slots = ['template-0', 'template-1', 'template-2', 'template-3'];

    const raw = JSON.stringify(old);

    localStorage.setItem(STORAGE_KEY, raw);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Sem espaço', 'QuotaExceededError');
    });

    await load();

    expect(button('speak:2').textContent).toContain('Quero água');

    expect(button('speak:3').textContent).toContain('Preciso de ajuda');

    expect(text('notice')).toContain('guardar a atualização');

    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('supports pointer-style click activation without app calibration or dwell timers', async () => {
    await load();

    mocks.speaking = true;

    button('speak:2').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mocks.speak).toHaveBeenCalledWith('Preciso de ir à casa de banho');

    expect(text('spoken')).toContain('A dizer:');

    mocks.changed(true);

    mocks.changed(false);

    expect(text('spoken')).toBe('Pronto para a próxima frase.');

    button('sound').click();

    expect(mocks.speak).toHaveBeenLastCalledWith('Olá. Esta é a minha voz.');

    mocks.notify('Falha de voz');

    expect(text('notice')).toBe('Falha de voz');
  });

  it('pages the catalogue, cancels changes and persists a replacement', async () => {
    await load();

    expect(button('catalogue').textContent).toBe('Escolher outra frase guardada');

    button('catalogue').click();

    expect(document.querySelector('.page-indicator')?.textContent).toBe('página 1 de 8');

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

    expect(document.querySelector('.page-indicator')?.textContent).toBe('página 2 de 8');

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

    button('replace:0').click();

    expect(parseBoard(localStorage.getItem(STORAGE_KEY) ?? '').slots[0]).toBe('template-4');

    expect(text('spoken')).toContain('Botão atualizado');

    button('catalogue').click();

    while (!button('next').disabled) button('next').click();

    expect(text('screen-hint')).toContain('página 8 de 8');

    button('next').click();

    expect(text('screen-hint')).toContain('página 8 de 8');
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
  });

  it('shows only centered phrase text on speaking and catalogue buttons', async () => {
    await load();

    for (const target of document.querySelectorAll('.phrase-button')) {
      expect(target.querySelector('small')).toBeNull();

      expect(target.children).toHaveLength(1);

      expect(target.textContent).toBe(target.querySelector('.button-text')?.textContent);
    }

    button('catalogue').click();

    expect(document.querySelector('.phrase-button small')).toBeNull();
  });

  it('persists old default upgrades and preserves saved choices when migration storage fails', async () => {
    const old = defaultBoard();

    old.phrases = old.phrases.slice(0, 28);

    old.slots = ['template-0', 'template-1', 'template-2', 'template-3'];

    const raw = JSON.stringify(old);

    localStorage.setItem(STORAGE_KEY, raw);

    await load();

    expect(button('speak:2').textContent).toContain('casa de banho');

    expect(button('speak:3').textContent).toContain('Tenho dores');

    expect(parseBoard(localStorage.getItem(STORAGE_KEY) ?? '').phrases).toHaveLength(29);

    localStorage.setItem(STORAGE_KEY, raw);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Sem espaço', 'QuotaExceededError');
    });

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(text('notice')).toContain('guardar a atualização');

    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
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

    expect(text('notice')).toContain('Frase guardada');

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

    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));

    await load();

    expect(button('speak:0').classList.contains('medium-phrase')).toBe(true);

    expect(button('speak:1').classList.contains('long-phrase')).toBe(true);
  });

  it('does not overwrite corrupt saved data', async () => {
    localStorage.setItem(STORAGE_KEY, '{bad');

    await load();

    expect(text('notice')).toContain('não serão alterados');

    button('catalogue').click();

    button('choose:template-1').click();

    button('replace:0').click();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('{bad');

    expect(text('notice')).toContain('Não as vamos substituir');
  });

  it('reports storage quota errors without claiming a successful replacement or addition', async () => {
    await load();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Sem espaço', 'QuotaExceededError');
    });

    button('catalogue').click();

    button('choose:template-1').click();

    button('replace:0').click();

    expect(text('notice')).toContain('Nada foi alterado');

    expect(text('screen-title')).toBe('Qual botão quer mudar?');

    button('board').click();

    button('add').click();

    submit('Uma frase nova');

    expect(document.querySelector('form')).not.toBeNull();

    expect(text('notice')).toContain('Nada foi alterado');
  });

  it('refreshes cross-tab phrase changes and handles cleared, unrelated and corrupt storage', async () => {
    await load();

    button('catalogue').click();

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));

    expect(text('screen-title')).toBe('Escolha uma frase');

    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultBoard()));

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(text('notice')).toContain('noutro separador');

    localStorage.removeItem(STORAGE_KEY);

    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(document.querySelectorAll('.phrase-button')).toHaveLength(4);

    localStorage.setItem(STORAGE_KEY, '{bad');

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(text('notice')).toContain('não puderam ser lidas');
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
});

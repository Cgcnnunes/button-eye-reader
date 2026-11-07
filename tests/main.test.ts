// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingFrame } from '../src/gaze';
import { defaultBoard, parseBoard, STORAGE_KEY } from '../src/store';

const mocks = vi.hoisted(() => ({
  changed: vi.fn<(busy: boolean) => void>(),
  error: vi.fn<(error: Error) => void>(),
  frame: vi.fn<(frame: TrackingFrame) => void>(),
  notify: vi.fn<(message: string) => void>(),
  speak: vi.fn<(text: string) => void>(),
  start: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => void>(),
}));

vi.mock('../src/gaze', () => ({
  CameraTracker: class {
    constructor(frame: (frame: TrackingFrame) => void, error: (error: Error) => void) {
      mocks.frame.mockImplementation(frame);

      mocks.error.mockImplementation(error);
    }

    start = mocks.start;
    stop = mocks.stop;
  },
}));

vi.mock('../src/speech', () => ({
  Speaker: class {
    speaking = false;

    constructor(notify: (message: string) => void, changed: (busy: boolean) => void) {
      mocks.notify.mockImplementation(notify);

      mocks.changed.mockImplementation(changed);
    }

    speak(text: string): void {
      mocks.speak(text);
    }

    stop(): void {
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

  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`Missing test button ${action}`);
  }

  return found;
}

function text(id: string): string {
  return document.getElementById(id)?.textContent ?? '';
}

async function load(): Promise<void> {
  await import('../src/main');
}

async function start(): Promise<void> {
  button('eye-toggle').click();

  await vi.waitFor(() => {
    expect(document.getElementById('calibration')?.hidden).toBe(false);
  });
}

function emit(features: number[] | null): void {
  vi.advanceTimersByTime(80);

  mocks.frame({ features, time: performance.now() });
}

function calibrate(staticSignal = false): void {
  let frames = 0;

  while (!document.getElementById('calibration')?.hidden && frames < 600) {
    const target = document.getElementById('calibration-target');

    if (!target) {
      throw new Error('Missing calibration target');
    }

    emit(
      staticSignal
        ? [0.5, 0.5]
        : [Number.parseFloat(target.style.left) / 100, Number.parseFloat(target.style.top) / 100],
    );

    frames++;
  }
}

function look(action: string, count = 35): void {
  const rect = button(action).getBoundingClientRect();

  for (let i = 0; i < count; i++) {
    emit([(rect.left + rect.width / 2) / innerWidth, (rect.top + rect.height / 2) / innerHeight]);
  }
}

function away(): void {
  for (let i = 0; i < 15; i++) {
    emit([0.5, 0.5]);
  }
}

describe('phrase board and gaze UI regression', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.useFakeTimers();

    vi.clearAllMocks();

    mocks.start.mockResolvedValue(undefined);

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

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ): DOMRect {
      const index = [...(this.parentElement?.children ?? [])].indexOf(this);
      const control = this.classList.contains('control-button');
      const columns = control && this.parentElement?.classList.contains('three-controls') ? 3 : 2;
      const width = columns === 3 ? 350 : 540;
      const x = 30 + (index % columns) * (width + 40);
      const y = control ? 630 : 150 + Math.floor(index / 2) * 240;

      return new DOMRect(x, y, width, control ? 100 : 200);
    });

    vi.stubGlobal('innerWidth', 1180);

    vi.stubGlobal('innerHeight', 820);
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

    vi.useRealTimers();
  });

  it('keeps exactly four speaking targets and a caregiver-only writing control', async () => {
    await load();

    expect(document.querySelectorAll('.phrase-button')).toHaveLength(4);

    expect(button('add').hasAttribute('data-gaze')).toBe(false);

    expect(button('catalogue').hasAttribute('data-gaze')).toBe(true);

    button('speak:2').click();

    expect(mocks.speak).toHaveBeenCalledWith('Quero água');

    expect(text('screen-title')).toBe('O que quer dizer?');

    expect(document.querySelector('footer')?.textContent).toContain('v0.1.0-test');
  });

  it('pages the catalogue, cancels changes and persists a replacement', async () => {
    await load();

    button('catalogue').click();

    expect(button('previous').disabled).toBe(true);

    button('next').click();

    button('previous').click();

    button('choose:template-1').click();

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
  });

  it('adds literal text, rejects duplicate phrases and never inserts user markup', async () => {
    await load();

    button('add').click();

    const input = document.querySelector('textarea');

    if (!input) {
      throw new Error('Missing textarea');
    }

    input.value = 'SIM';

    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(text('notice')).toContain('já existe');

    input.value = '<img src=x onerror=alert(1)>';

    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(text('notice')).toContain('Frase guardada');

    expect(document.querySelector('img')).toBeNull();

    button('board').click();

    button('add').click();

    button('form-back').click();

    expect(text('screen-title')).toBe('O que quer dizer?');
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

  it('reports storage quota errors without claiming a successful replacement', async () => {
    await load();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Sem espaço', 'QuotaExceededError');
    });

    button('catalogue').click();

    button('choose:template-1').click();

    button('replace:0').click();

    expect(text('notice')).toContain('Nada foi alterado');

    expect(text('screen-title')).toBe('Qual botão quer mudar?');
  });

  it('handles camera permission failure and canceling startup', async () => {
    await load();

    mocks.start.mockRejectedValueOnce(new Error('Permissão recusada'));

    button('eye-toggle').click();

    await vi.waitFor(() => {
      expect(text('notice')).toContain('Permissão recusada');
    });

    let finish: () => void = (): void => {
      throw new Error('Startup promise is not installed');
    };

    mocks.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    button('eye-toggle').click();

    button('eye-stop').click();

    finish();

    await Promise.resolve();

    expect(text('tracking')).toBe('Olhar desligado');
  });

  it('rejects static gaze calibration and never enables selection', async () => {
    await load();

    await start();

    calibrate(true);

    expect(text('notice')).toContain('não foi suficientemente precisa');

    expect(text('tracking')).toBe('Olhar desligado');
  });

  it('times out when eyes are not reliably detected', async () => {
    await load();

    await start();

    for (let i = 0; i < 200; i++) {
      emit(null);
    }

    expect(text('notice')).toContain('Não foi possível ver os olhos');

    expect(text('tracking')).toBe('Olhar desligado');
  });

  it('supports the entire catalogue replacement flow using only calibrated gaze', async () => {
    await load();

    await start();

    calibrate();

    expect(text('tracking')).toBe('Olhar ativo');

    expect(document.getElementById('shell')?.inert).toBe(false);

    away();

    look('catalogue');

    expect(text('screen-title')).toBe('Escolha uma frase');

    away();

    look('next');

    away();

    look('choose:template-4');

    expect(text('screen-title')).toBe('Qual botão quer mudar?');

    away();

    look('replace:2');

    away();

    look('speak:2', 24);

    expect(mocks.speak).not.toHaveBeenCalledWith('Tenho fome');

    look('speak:2', 12);

    expect(mocks.speak).toHaveBeenCalledWith('Tenho fome');

    const count = mocks.speak.mock.calls.length;

    look('speak:2', 60);

    emit(null);

    look('speak:2', 40);

    expect(mocks.speak).toHaveBeenCalledTimes(count);

    emit([100, 100]);

    expect(text('tracking')).toContain('em pausa');
  });

  it.each(['resize', 'scroll', 'pagehide'])(
    'disables and requires recalibration on %s',
    async (event) => {
      await load();

      await start();

      window.dispatchEvent(new Event(event));

      expect(text('tracking')).toBe('Olhar desligado');

      expect(document.getElementById('calibration')?.hidden).toBe(true);
    },
  );

  it('supports Escape, cancel, capture errors and caregiver-only writing', async () => {
    await load();

    await start();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(text('tracking')).toBe('Olhar desligado');

    await start();

    button('cancel-calibration').click();

    expect(document.activeElement?.id).toBe('eye-toggle');

    await start();

    mocks.error(new Error('A imagem parou'));

    expect(text('notice')).toContain('A imagem parou');

    button('sound').click();

    expect(mocks.speak).toHaveBeenCalledWith('Olá. Esta é a minha voz.');

    button('add').click();

    button('eye-toggle').click();

    expect(text('notice')).toContain('Termine a escrita');
  });

  it('stops camera when hidden and refreshes valid cross-tab changes', async () => {
    await load();

    await start();

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(text('notice')).toContain('saiu da aplicação');

    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultBoard()));

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(text('notice')).toContain('noutro separador');

    localStorage.setItem(STORAGE_KEY, '{bad');

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(text('notice')).toContain('não puderam ser lidas');
  });
});

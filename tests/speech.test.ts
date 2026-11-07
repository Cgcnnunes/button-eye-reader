import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Speaker } from '../src/speech';

class Utterance {
  lang = '';
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

describe('Portuguese speech', () => {
  const notify = vi.fn();
  const changed = vi.fn();
  const speak = vi.fn<(utterance: Utterance) => void>();
  const cancel = vi.fn();
  let speaker: Speaker;

  beforeEach(() => {
    vi.useFakeTimers();

    vi.clearAllMocks();

    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);

    vi.stubGlobal('window', {
      speechSynthesis: { cancel, getVoices: () => [{ lang: 'pt-PT', name: 'Joana' }], speak },
    });

    speaker = new Speaker(notify, changed);
  });

  afterEach(() => {
    vi.useRealTimers();

    vi.unstubAllGlobals();
  });

  it('uses a pt-PT voice and prevents queued repeats', () => {
    speaker.speak('Quero água');

    speaker.speak('Sim');

    expect(speak).toHaveBeenCalledTimes(1);

    const utterance: Utterance = speak.mock.calls[0][0];

    expect(utterance.lang).toBe('pt-PT');

    expect(utterance.voice?.lang).toBe('pt-PT');

    expect(utterance.text).toBe('Quero água');

    utterance.onend?.();

    expect(speaker.speaking).toBe(false);
  });

  it('surfaces missing voices and blocked browser audio', () => {
    vi.stubGlobal('window', { speechSynthesis: { cancel, getVoices: () => [], speak } });

    speaker.speak('Olá');

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('pt-PT não confirmada'));

    vi.advanceTimersByTime(12000);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('autorizar o áudio'));

    expect(speaker.speaking).toBe(false);
  });

  it('reports speech errors without getting stuck', () => {
    speaker.speak('Sim');

    const utterance: Utterance = speak.mock.calls[0][0];

    utterance.onerror?.({ error: 'not-allowed' });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('not-allowed'));

    expect(speaker.speaking).toBe(false);
  });

  it('ignores late canceled events from a previous utterance', () => {
    speaker.speak('Sim');

    const first: Utterance = speak.mock.calls[0][0];

    speaker.stop();

    speaker.speak('Não');

    first.onend?.();

    expect(speaker.speaking).toBe(true);
  });

  it('reports unsupported browsers', () => {
    vi.stubGlobal('window', {});

    speaker.speak('Sim');

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('não suporta voz'));
  });

  it('reports a synchronous voice failure and clears the busy state', () => {
    speak.mockImplementationOnce(() => {
      throw new Error('voice unavailable');
    });

    speaker.speak('Sim');

    expect(notify).toHaveBeenCalledWith('Erro de voz: voice unavailable');

    expect(speaker.speaking).toBe(false);
  });

  it('distinguishes a voice that starts but never ends', () => {
    speaker.speak('Sim');

    speak.mock.calls[0][0].onstart?.();

    vi.advanceTimersByTime(12000);

    expect(notify).toHaveBeenCalledWith('A voz demorou demasiado. Teste o som novamente.');

    expect(speaker.speaking).toBe(false);
  });

  it('does not report normal cancellation as a playback error', () => {
    speaker.speak('Sim');

    speak.mock.calls[0][0].onerror?.({ error: 'canceled' });

    expect(notify).not.toHaveBeenCalled();

    expect(speaker.speaking).toBe(false);
  });
});

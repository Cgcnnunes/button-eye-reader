export class Speaker {
  private busy = false;
  private utterance: SpeechSynthesisUtterance | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  private readonly notify: (message: string) => void;
  private readonly changed: (busy: boolean) => void;

  constructor(notify: (message: string) => void, changed: (busy: boolean) => void) {
    this.notify = notify;

    this.changed = changed;
  }

  get speaking(): boolean {
    return this.busy;
  }

  speak(text: string): void {
    if (!('speechSynthesis' in window)) {
      this.notify('Este navegador não suporta voz. Use o Safari atualizado.');

      return;
    }

    if (this.busy) return;

    const speech = window.speechSynthesis;
    const voice = speech
      .getVoices()
      .find((item) => item.lang.replace('_', '-').toLowerCase() === 'pt-pt');
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = 'pt-PT';

    if (voice) utterance.voice = voice;
    else
      this.notify(
        'Voz pt-PT não confirmada. Verifique as vozes portuguesas nas definições do iPad e teste o som.',
      );

    utterance.rate = 0.85;

    utterance.volume = 1;

    this.utterance = utterance;

    this.busy = true;

    this.changed(true);

    utterance.onend = () => {
      if (this.utterance === utterance) this.finish();
    };

    utterance.onerror = (event) => {
      if (this.utterance !== utterance) return;

      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        this.notify(
          `Não foi possível falar (${event.error}). Toque em «Testar som» e verifique o volume.`,
        );
      }

      this.finish();
    };

    let started = false;

    utterance.onstart = () => {
      started = true;
    };

    this.watchdog = setTimeout(
      () => {
        this.notify(
          started
            ? 'A voz demorou demasiado. Teste o som novamente.'
            : 'A voz não arrancou. Toque em «Testar som» para autorizar o áudio.',
        );

        this.stop();
      },
      Math.max(12000, text.length * 250),
    );

    try {
      speech.speak(utterance);
    } catch (error) {
      this.notify(
        error instanceof Error
          ? `Erro de voz: ${error.message}`
          : 'Não foi possível iniciar a voz.',
      );

      this.finish();
    }
  }

  stop(): void {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    this.finish();
  }

  private finish(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);

    this.watchdog = null;

    this.utterance = null;

    this.busy = false;

    this.changed(false);
  }
}

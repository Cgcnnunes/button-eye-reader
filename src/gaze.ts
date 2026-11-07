import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { extractFeatures } from './gaze-math';

export interface TrackingFrame {
  features: number[] | null;
  time: number;
}

export class CameraTracker {
  private model: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private lastVideoTime = -1;
  private lastFreshFrame = 0;
  readonly video = document.createElement('video');

  private readonly onFrame: (frame: TrackingFrame) => void;
  private readonly onError: (error: Error) => void;

  constructor(onFrame: (frame: TrackingFrame) => void, onError: (error: Error) => void) {
    this.onFrame = onFrame;

    this.onError = onError;

    this.video.autoplay = true;

    this.video.muted = true;

    this.video.playsInline = true;

    this.video.className = 'camera-feed';

    this.video.setAttribute('aria-hidden', 'true');

    document.body.append(this.video);
  }

  async start(): Promise<void> {
    this.stop();

    const generation = this.generation;

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      throw new Error('A câmara precisa de Safari atualizado e de uma ligação HTTPS.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        frameRate: { ideal: 15, max: 20 },
        height: { ideal: 480 },
        width: { ideal: 640 },
      },
    });

    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });

      return;
    }

    this.stream = stream;

    this.video.srcObject = stream;

    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (generation === this.generation) {
        this.stop();

        this.onError(new Error('A câmara foi desligada. Ative o olhar e calibre novamente.'));
      }
    });

    try {
      await this.video.play();

      const fileset = await FilesetResolver.forVisionTasks('/vision/wasm');
      const model = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { delegate: 'CPU', modelAssetPath: '/vision/face_landmarker.task' },
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
        numFaces: 2,
        runningMode: 'VIDEO',
      });

      if (generation !== this.generation) {
        model.close();

        return;
      }

      this.model = model;

      this.lastVideoTime = -1;

      this.lastFreshFrame = performance.now();

      this.tick(generation);
    } catch (error) {
      if (generation === this.generation) this.stop();

      throw error;
    }
  }

  stop(): void {
    this.generation++;

    if (this.timer !== null) clearTimeout(this.timer);

    this.timer = null;

    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });

    this.stream = null;

    this.video.pause();

    this.video.srcObject = null;

    this.model?.close();

    this.model = null;
  }

  private tick(generation: number): void {
    if (generation !== this.generation || !this.model) return;

    const time = performance.now();

    try {
      let features: number[] | null = null;

      if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;

        this.lastFreshFrame = time;

        const result = this.model.detectForVideo(this.video, time);

        if (result.faceLandmarks.length === 1) features = extractFeatures(result.faceLandmarks[0]);
      }

      if (time - this.lastFreshFrame > 1500)
        throw new Error('A imagem da câmara parou. Ative o olhar novamente.');

      this.onFrame({ features, time });
    } catch (error) {
      this.stop();

      this.onError(
        error instanceof Error ? error : new Error('Não foi possível ler a imagem da câmara.'),
      );

      return;
    }

    this.timer = setTimeout(() => {
      this.tick(generation);
    }, 80);
  }
}

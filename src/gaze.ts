import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { extractFeatures } from './gaze-math';

export interface TrackingFrame {
  faceBounds: FaceBounds | null;
  faceCount: number;
  features: number[] | null;
  time: number;
}

export interface FaceBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface FaceAlignment {
  aligned: boolean;
  facePositioned: boolean;
  message: string;
}

export function assessFaceAlignment(frame: TrackingFrame, targetWidth: number): FaceAlignment {
  if (frame.faceCount === 0 || !frame.faceBounds) {
    return { aligned: false, facePositioned: false, message: 'Olhe para a câmara.' };
  }

  if (frame.faceCount > 1) {
    return {
      aligned: false,
      facePositioned: false,
      message: 'Peça às outras pessoas para saírem da imagem.',
    };
  }

  const { bottom, left, right, top } = frame.faceBounds;
  const centerX = 1 - (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const width = right - left;

  if (width < targetWidth * 0.78) {
    return { aligned: false, facePositioned: false, message: 'Aproxime um pouco o rosto.' };
  }

  if (width > targetWidth * 1.25) {
    return { aligned: false, facePositioned: false, message: 'Afaste um pouco o rosto.' };
  }

  if (centerX < 0.39) {
    return {
      aligned: false,
      facePositioned: false,
      message: 'Mova a cabeça um pouco para a direita.',
    };
  }

  if (centerX > 0.61) {
    return {
      aligned: false,
      facePositioned: false,
      message: 'Mova a cabeça um pouco para a esquerda.',
    };
  }

  if (centerY < 0.34) {
    return { aligned: false, facePositioned: false, message: 'Baixe um pouco a cabeça.' };
  }

  if (centerY > 0.62) {
    return { aligned: false, facePositioned: false, message: 'Levante um pouco a cabeça.' };
  }

  if (!frame.features) {
    return {
      aligned: false,
      facePositioned: true,
      message: 'Mantenha os olhos abertos e os dois olhos visíveis.',
    };
  }

  return {
    aligned: true,
    facePositioned: true,
    message: 'Rosto bem posicionado. Mantenha os olhos dentro do oval.',
  };
}

function faceBounds(points: NormalizedLandmark[]): FaceBounds | null {
  const visible = points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 &&
      point.x <= 1 &&
      point.y >= 0 &&
      point.y <= 1,
  );

  if (!visible.length) return null;

  return {
    bottom: Math.max(...visible.map((point) => point.y)),
    left: Math.min(...visible.map((point) => point.x)),
    right: Math.max(...visible.map((point) => point.x)),
    top: Math.min(...visible.map((point) => point.y)),
  };
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

  get videoDeviceId(): string {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? '';
  }

  async listVideoInputs(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];

    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'videoinput',
    );
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();

    const generation = this.generation;

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      throw new Error('A câmara precisa de Safari atualizado e de uma ligação HTTPS.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }),
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
      let bounds: FaceBounds | null = null;
      let faceCount = 0;

      if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;

        this.lastFreshFrame = time;

        const result = this.model.detectForVideo(this.video, time);

        faceCount = result.faceLandmarks.length;

        if (faceCount === 1) {
          bounds = faceBounds(result.faceLandmarks[0]);

          features = extractFeatures(result.faceLandmarks[0]);
        }
      }

      if (time - this.lastFreshFrame > 1500)
        throw new Error('A imagem da câmara parou. Ative o olhar novamente.');

      this.onFrame({ faceBounds: bounds, faceCount, features, time });
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

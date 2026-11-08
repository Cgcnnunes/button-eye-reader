import type { FaceLandmarkerOptions } from '@mediapipe/tasks-vision';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assessFaceAlignment,
  CameraTracker,
  type EyeMarkers,
  type TrackingFrame,
} from '../src/gaze';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  create: vi.fn<(fileset: unknown, options: FaceLandmarkerOptions) => Promise<unknown>>(),
  detect: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FaceLandmarker: { createFromOptions: mocks.create },
  FilesetResolver: { forVisionTasks: mocks.resolve },
}));

describe('camera lifecycle', () => {
  const frame = vi.fn<(frame: TrackingFrame) => void>();
  const error = vi.fn();
  const stop = vi.fn();
  const play = vi.fn();
  const pause = vi.fn();
  const getUserMedia = vi.fn<(options: MediaStreamConstraints) => Promise<unknown>>();
  const listener = vi.fn<(name: string, handler: () => void) => void>();
  let tracker: CameraTracker;

  beforeEach(() => {
    vi.useFakeTimers();

    vi.clearAllMocks();

    mocks.resolve.mockResolvedValue({});

    mocks.create.mockResolvedValue({ close: mocks.close, detectForVideo: mocks.detect });

    mocks.detect.mockReturnValue({ faceLandmarks: [] });

    play.mockResolvedValue(undefined);

    const track = { addEventListener: listener, stop };

    getUserMedia.mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });

    vi.stubGlobal('window', { isSecureContext: true });

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: () => ({ currentTime: 1, pause, play, readyState: 2, setAttribute: vi.fn() }),
    });

    tracker = new CameraTracker(frame, error, true);
  });

  afterEach(() => {
    tracker.stop();

    vi.useRealTimers();

    vi.unstubAllGlobals();
  });

  it('requests only the front camera and loads self-hosted assets', async () => {
    await tracker.start();

    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));

    const constraints = getUserMedia.mock.calls[0][0];

    if (typeof constraints.video !== 'object') {
      throw new Error('Expected video constraints');
    }

    expect(constraints.video.facingMode).toEqual({ ideal: 'user' });

    expect(mocks.resolve).toHaveBeenCalledWith('/vision/wasm');

    expect(mocks.create.mock.calls[0][1].baseOptions?.modelAssetPath).toBe(
      '/vision/face_landmarker.task',
    );

    expect(frame).toHaveBeenCalledWith(expect.objectContaining({ features: null }));

    tracker.stop();

    expect(stop).toHaveBeenCalledTimes(1);

    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('can select a connected PC camera for manual prototyping', async () => {
    await tracker.start('usb-camera');

    const constraints = getUserMedia.mock.calls[0][0];

    if (typeof constraints.video !== 'object') {
      throw new Error('Expected video constraints');
    }

    expect(constraints.video.deviceId).toEqual({ exact: 'usb-camera' });

    expect(constraints.video).not.toHaveProperty('facingMode');
  });

  it('lists only video input devices after camera permission', async () => {
    const camera = { deviceId: 'front', kind: 'videoinput' } as MediaDeviceInfo;
    const microphone = { deviceId: 'mic', kind: 'audioinput' } as MediaDeviceInfo;
    const enumerateDevices = vi.fn().mockResolvedValue([camera, microphone]);

    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices, getUserMedia } });

    await expect(tracker.listVideoInputs()).resolves.toEqual([camera]);
  });

  it('stops a stream granted after the user canceled', async () => {
    let grant: (stream: unknown) => void = () => {
      throw new Error('grant was not set');
    };

    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );

    const pending = tracker.start();

    tracker.stop();

    grant({ getTracks: () => [{ stop }] });

    await pending;

    expect(stop).toHaveBeenCalledTimes(1);

    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('closes a model that finishes loading after cancellation', async () => {
    let finish: (model: unknown) => void = () => {
      throw new Error('finish was not set');
    };

    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const pending = tracker.start();

    await vi.waitFor(() => {
      expect(mocks.create).toHaveBeenCalled();
    });

    tracker.stop();

    finish({ close: mocks.close });

    await pending;

    expect(mocks.close).toHaveBeenCalledTimes(1);

    expect(frame).not.toHaveBeenCalled();
  });

  it('fails visibly and releases the camera if model loading fails', async () => {
    mocks.create.mockRejectedValue(new Error('model unavailable'));

    await expect(tracker.start()).rejects.toThrow('model unavailable');

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not treat two faces as a valid gaze signal', async () => {
    mocks.detect.mockReturnValue({ faceLandmarks: [[], []] });

    await tracker.start();

    expect(frame).toHaveBeenCalledWith(
      expect.objectContaining({ faceBounds: null, faceCount: 2, features: null }),
    );
  });

  it('reports the detected face bounds even when eye features are unavailable', async () => {
    const points = Array.from({ length: 478 }, (_, index) => ({
      visibility: 1,
      x: 0.3 + index / 4780,
      y: 0.25 + index / 9560,
      z: 0,
    }));

    mocks.detect.mockReturnValue({ faceLandmarks: [points] });

    await tracker.start();

    const result = frame.mock.calls[0]?.[0];

    expect(result?.faceCount).toBe(1);

    expect(result?.features).toBeNull();

    expect(result?.faceBounds?.left).toBeCloseTo(0.3);

    expect(result?.faceBounds?.right).toBeCloseTo(0.4);

    expect(result?.faceBounds?.top).toBeCloseTo(0.25);

    expect(result?.faceBounds?.bottom).toBeCloseTo(0.3);
  });

  it('reports eye and iris bounds for local eye-tracking diagnostics', async () => {
    const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const landmarks = new Map<number, { x: number; y: number }>([
      [33, { x: 0.4, y: 0.42 }],
      [133, { x: 0.48, y: 0.42 }],
      [159, { x: 0.44, y: 0.39 }],
      [145, { x: 0.44, y: 0.45 }],
      [263, { x: 0.6, y: 0.42 }],
      [362, { x: 0.52, y: 0.42 }],
      [374, { x: 0.56, y: 0.45 }],
      [386, { x: 0.56, y: 0.39 }],
      [468, { x: 0.44, y: 0.42 }],
      [469, { x: 0.43, y: 0.42 }],
      [470, { x: 0.44, y: 0.41 }],
      [471, { x: 0.45, y: 0.42 }],
      [472, { x: 0.44, y: 0.43 }],
      [473, { x: 0.56, y: 0.42 }],
      [474, { x: 0.55, y: 0.42 }],
      [475, { x: 0.56, y: 0.41 }],
      [476, { x: 0.57, y: 0.42 }],
      [477, { x: 0.56, y: 0.43 }],
    ]);

    for (const [index, landmark] of landmarks) {
      points[index] = { ...landmark, z: 0 };
    }

    mocks.detect.mockReturnValue({ faceLandmarks: [points] });

    await tracker.start();

    const result = frame.mock.calls[0]?.[0];

    const expected: EyeMarkers = {
      leftEye: { bottom: 0.45, left: 0.4, right: 0.48, top: 0.39 },
      leftIris: { bottom: 0.43, left: 0.43, right: 0.45, top: 0.41 },
      rightEye: { bottom: 0.45, left: 0.52, right: 0.6, top: 0.39 },
      rightIris: { bottom: 0.43, left: 0.55, right: 0.57, top: 0.41 },
    };

    expect(result?.eyeMarkers).toEqual(expected);
  });

  it('reports frozen video rather than using stale positions', async () => {
    await tracker.start();

    await vi.advanceTimersByTimeAsync(1600);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'A imagem da câmara parou. Ative o olhar novamente.' }),
    );

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('reports capture and detector errors', async () => {
    mocks.detect.mockImplementation(() => {
      throw new Error('detection failed');
    });

    await tracker.start();

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'detection failed' }));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not attempt capture on an insecure origin', async () => {
    vi.stubGlobal('window', { isSecureContext: false });

    await expect(tracker.start()).rejects.toThrow('HTTPS');

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reports an unexpectedly ended camera track', async () => {
    await tracker.start();

    listener.mock.calls[0][1]();

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'A câmara foi desligada. Ative o olhar e calibre novamente.',
      }),
    );

    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('face positioning guidance', () => {
  const alignedBounds = { bottom: 0.66, left: 0.36, right: 0.64, top: 0.3 };
  const alignedFrame: TrackingFrame = {
    faceBounds: alignedBounds,
    faceCount: 1,
    features: [0.5],
    time: 0,
  };

  it('accepts a centered face with visible eyes', () => {
    expect(assessFaceAlignment(alignedFrame, 0.28)).toMatchObject({
      aligned: true,
      facePositioned: true,
    });
  });

  it('asks the person to move closer or farther based on face size', () => {
    expect(assessFaceAlignment(alignedFrame, 0.4).message).toContain('Aproxime');

    expect(assessFaceAlignment(alignedFrame, 0.18).message).toContain('Afaste');
  });

  it('gives mirrored horizontal and vertical movement hints', () => {
    expect(
      assessFaceAlignment(
        { ...alignedFrame, faceBounds: { ...alignedBounds, left: 0.52, right: 0.8 } },
        0.28,
      ).message,
    ).toContain('direita');

    expect(
      assessFaceAlignment(
        { ...alignedFrame, faceBounds: { ...alignedBounds, left: 0.2, right: 0.48 } },
        0.28,
      ).message,
    ).toContain('esquerda');

    expect(
      assessFaceAlignment(
        { ...alignedFrame, faceBounds: { ...alignedBounds, bottom: 0.41, top: 0.05 } },
        0.28,
      ).message,
    ).toContain('Baixe');

    expect(
      assessFaceAlignment(
        { ...alignedFrame, faceBounds: { ...alignedBounds, bottom: 0.94, top: 0.58 } },
        0.28,
      ).message,
    ).toContain('Levante');
  });

  it('distinguishes no face, multiple faces, and eyes that are not visible', () => {
    expect(
      assessFaceAlignment({ ...alignedFrame, faceBounds: null, faceCount: 0 }, 0.28).message,
    ).toContain('Olhe');

    expect(assessFaceAlignment({ ...alignedFrame, faceCount: 2 }, 0.28).message).toContain(
      'outras pessoas',
    );

    expect(assessFaceAlignment({ ...alignedFrame, features: null }, 0.28).message).toContain(
      'olhos abertos',
    );
  });
});

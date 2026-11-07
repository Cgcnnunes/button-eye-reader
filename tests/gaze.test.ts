import type { FaceLandmarkerOptions } from '@mediapipe/tasks-vision';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraTracker } from '../src/gaze';

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
  const frame = vi.fn();
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

    tracker = new CameraTracker(frame, error);
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

    expect(constraints.video.facingMode).toBe('user');

    expect(mocks.resolve).toHaveBeenCalledWith('/vision/wasm');

    expect(mocks.create.mock.calls[0][1].baseOptions?.modelAssetPath).toBe(
      '/vision/face_landmarker.task',
    );

    expect(frame).toHaveBeenCalledWith(expect.objectContaining({ features: null }));

    tracker.stop();

    expect(stop).toHaveBeenCalledTimes(1);

    expect(mocks.close).toHaveBeenCalledTimes(1);
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

    expect(frame).toHaveBeenCalledWith(expect.objectContaining({ features: null }));
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

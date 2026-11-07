export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}
export interface Target {
  id: string;
  rect: Rect;
}

export function contains(rect: Rect, point: Point, inset = 0): boolean {
  return (
    point.x >= rect.left + inset &&
    point.x <= rect.right - inset &&
    point.y >= rect.top + inset &&
    point.y <= rect.bottom - inset
  );
}

export const DWELL_MS = 2000;

const RELEASE_MS = 400;
const MAX_GAP_MS = 350;

export class Dwell {
  private active: string | null = null;
  private since = 0;
  private last = 0;
  private blocked: Rect | null = null;
  private outsideSince: number | null = null;

  reset(): void {
    this.active = null;

    this.since = 0;

    this.last = 0;
  }

  block(rect: Rect): void {
    this.reset();

    this.blocked = rect;

    this.outsideSince = null;
  }

  update(
    point: Point | null,
    targets: Target[],
    now: number,
  ): { fire: boolean; id: string | null; progress: number } {
    if (!point) {
      this.reset();

      this.outsideSince = null;

      return { fire: false, id: null, progress: 0 };
    }

    if (this.blocked) {
      if (contains(this.blocked, point)) this.outsideSince = null;
      else {
        this.outsideSince ??= now;

        if (now - this.outsideSince >= RELEASE_MS) this.blocked = null;
      }

      this.reset();

      return { fire: false, id: null, progress: 0 };
    }

    const target = targets.find(({ rect }) =>
      contains(
        rect,
        point,
        Math.min(24, (rect.right - rect.left) * 0.08, (rect.bottom - rect.top) * 0.08),
      ),
    );

    if (!target) {
      this.reset();

      return { fire: false, id: null, progress: 0 };
    }

    if (this.active !== target.id || now - this.last > MAX_GAP_MS) {
      this.active = target.id;

      this.since = now;
    }

    this.last = now;

    const progress = Math.min(1, (now - this.since) / DWELL_MS);

    if (progress === 1) this.block(target.rect);

    return { fire: progress === 1, id: target.id, progress };
  }
}

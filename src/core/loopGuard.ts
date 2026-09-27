/**
 * Feedback-loop guard for one axis. See docs/design.md → Resize → Feedback-loop guard.
 *
 * Content sized from the viewport (`height: 100vh` plus a margin, `100%` down a chain
 * of ancestors) grows with the iframe forever: every resize makes the content grow by
 * the same amount again. The signature is `content − viewport = c` for the same
 * `c ≠ 0` while the viewport keeps changing.
 */
export interface LoopGuard {
  /**
   * Feeds one measurement. Returns `true` while growth must be held, i.e. the iframe
   * must not be resized along this axis.
   */
  check(content: number, viewport: number): boolean;
  readonly tripped: boolean;
}

export const LOOP_THRESHOLD = 30;

export function createLoopGuard(threshold: number = LOOP_THRESHOLD): LoopGuard {
  let previousDelta: number | undefined;
  let previousViewport: number | undefined;
  let streak = 0;
  let trippedDelta: number | undefined;

  return {
    get tripped() {
      return trippedDelta !== undefined;
    },
    check(content, viewport) {
      const delta = content - viewport;

      if (trippedDelta !== undefined) {
        // While held, the viewport stops changing and the delta stays put. Only a real
        // content change (a different delta) ends the hold; checking for "the pattern
        // broke" instead would resume at once and grow in bursts.
        if (delta === trippedDelta) return true;
        trippedDelta = undefined;
        streak = 0;
      }

      const following =
        delta !== 0 &&
        delta === previousDelta &&
        previousViewport !== undefined &&
        viewport !== previousViewport;
      streak = following ? streak + 1 : 0;
      previousDelta = delta;
      previousViewport = viewport;

      if (streak >= threshold) {
        trippedDelta = delta;
        return true;
      }
      return false;
    },
  };
}

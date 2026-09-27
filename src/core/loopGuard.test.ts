import { describe, expect, it } from 'vitest';
import { createLoopGuard, LOOP_THRESHOLD } from './loopGuard';

// Content sized `100vh + 10px`: every resize to the content makes it 10px taller again.
function runaway(guard: ReturnType<typeof createLoopGuard>, steps: number, start = 150) {
  const results: boolean[] = [];
  let viewport = start;
  for (let i = 0; i < steps; i++) {
    const content = viewport + 10;
    const held = guard.check(content, viewport);
    results.push(held);
    if (!held) viewport = content; // the parent resizes the iframe to the content
  }
  return { results, viewport };
}

describe('createLoopGuard', () => {
  it('uses 30 as the default threshold', () => {
    expect(LOOP_THRESHOLD).toBe(30);
  });

  it('trips after `threshold` consecutive viewport-following measurements', () => {
    const guard = createLoopGuard(3);
    // 1st measurement sets the baseline, the next 3 follow the viewport.
    expect(runaway(guard, 4).results).toEqual([false, false, false, true]);
    expect(guard.tripped).toBe(true);
  });

  it('keeps holding while the content keeps following the frozen viewport', () => {
    const guard = createLoopGuard(3);
    const { results, viewport } = runaway(guard, 10);
    expect(results.slice(3)).toEqual(Array(7).fill(true));
    expect(viewport).toBe(180); // growth stopped for good, not in bursts
  });

  it('resumes when the content changes', () => {
    const guard = createLoopGuard(3);
    const { viewport } = runaway(guard, 5);

    expect(guard.check(viewport + 10, viewport)).toBe(true);
    expect(guard.check(viewport - 50, viewport)).toBe(false);
    expect(guard.tripped).toBe(false);
  });

  it('ignores a constant delta while the viewport stays put', () => {
    const guard = createLoopGuard(3);
    for (let i = 0; i < 10; i++) expect(guard.check(210, 200)).toBe(false);
  });

  it('ignores content that fits the viewport', () => {
    const guard = createLoopGuard(3);
    for (let viewport = 100; viewport < 200; viewport += 10) {
      expect(guard.check(viewport, viewport)).toBe(false);
    }
  });

  it('does not trip on growth with a changing delta', () => {
    const guard = createLoopGuard(3);
    let viewport = 100;
    for (const step of [9, 10, 9, 10, 9, 10, 9, 10]) {
      expect(guard.check(viewport + step, viewport)).toBe(false);
      viewport += step;
    }
  });
});

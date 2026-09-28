import { describe, expect, it } from 'vitest';
import { claimFrameTitle, frameA11yProblems } from './a11y';

describe('frameA11yProblems', () => {
  it('accepts a descriptive title and no tabIndex', () => {
    expect(frameA11yProblems('Order summary', undefined)).toEqual([]);
    expect(frameA11yProblems('Order summary', 0)).toEqual([]);
    expect(frameA11yProblems('Order summary', null)).toEqual([]);
  });

  it.each([undefined, '', '   '])('reports a missing title (%j)', (title) => {
    const [problem] = frameA11yProblems(title, undefined);
    expect(problem).toMatch(/^has no `title`/);
  });

  it.each([
    'iframe',
    ' Frame ',
    'untitled',
    'https://example.com/embed',
    '/embed/checkout',
    'about:blank',
    'widget.html',
  ])('reports a generic title (%j)', (title) => {
    const [problem] = frameA11yProblems(title, undefined);
    expect(problem).toBe(
      `has a generic \`title\` ("${title.trim()}"). Screen readers announce an iframe by its title; describe its content instead.`,
    );
  });

  it.each([-1, '-1'])('reports a negative tabIndex (%j)', (tabIndex) => {
    const [problem] = frameA11yProblems('Order summary', tabIndex);
    expect(problem).toMatch(/^has a negative `tabIndex`/);
  });

  it('reports a bad title and a negative tabIndex together', () => {
    expect(frameA11yProblems(undefined, -1)).toHaveLength(2);
  });
});

describe('claimFrameTitle', () => {
  it('reports a title another mounted frame already has, ignoring case and spaces', () => {
    const first = claimFrameTitle('Preview');
    const second = claimFrameTitle(' preview ');
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    first.release();
    second.release();
  });

  it('frees the title once every frame with it has released it', () => {
    const first = claimFrameTitle('Chart');
    const second = claimFrameTitle('Chart');
    first.release();
    const third = claimFrameTitle('Chart');
    expect(third.duplicate).toBe(true);
    second.release();
    third.release();
    const fourth = claimFrameTitle('Chart');
    expect(fourth.duplicate).toBe(false);
    fourth.release();
  });

  it('ignores a repeated release', () => {
    const first = claimFrameTitle('Map');
    const second = claimFrameTitle('Map');
    second.release();
    second.release();
    const third = claimFrameTitle('Map');
    expect(third.duplicate).toBe(true);
    first.release();
    third.release();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { applySize, axesOf, clamp } from './applySize';

afterEach(() => {
  document.body.innerHTML = '';
});

function iframe(style = ''): HTMLIFrameElement {
  const element = document.createElement('iframe');
  element.setAttribute('style', style);
  document.body.append(element);
  return element;
}

describe('axesOf', () => {
  it('maps an axis to the dimensions it resizes', () => {
    expect(axesOf('height')).toEqual({ width: false, height: true });
    expect(axesOf('width')).toEqual({ width: true, height: false });
    expect(axesOf('both')).toEqual({ width: true, height: true });
  });
});

describe('clamp', () => {
  it('limits a value to [min, max]', () => {
    expect(clamp(50, 10, 100)).toBe(50);
    expect(clamp(5, 10, 100)).toBe(10);
    expect(clamp(500, 10, 100)).toBe(100);
  });

  it('defaults to [0, ∞)', () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(1e9)).toBe(1e9);
  });
});

describe('applySize', () => {
  it('sets width and height in px', () => {
    const element = iframe();
    applySize(element, 320, 240);
    expect(element.style.width).toBe('320px');
    expect(element.style.height).toBe('240px');
  });

  it('leaves an axis alone when it is undefined', () => {
    const element = iframe('width: 111px; height: 222px');
    applySize(element, undefined, 50);
    expect(element.style.width).toBe('111px');
    expect(element.style.height).toBe('50px');
    applySize(element, 70, undefined);
    expect(element.style.width).toBe('70px');
    expect(element.style.height).toBe('50px');
  });

  it('adds border and padding with box-sizing: border-box', () => {
    const element = iframe(
      'box-sizing: border-box; border: 2px solid; padding: 3px 4px; border-left-width: 1px',
    );
    applySize(element, 100, 100);
    expect(element.style.width).toBe(`${100 + 1 + 2 + 4 + 4}px`);
    expect(element.style.height).toBe(`${100 + 2 + 2 + 3 + 3}px`);
  });

  it('adds nothing for a border-box iframe without border or padding', () => {
    const element = iframe('box-sizing: border-box; border: 0; padding: 0');
    applySize(element, 100, 100);
    expect(element.style.height).toBe('100px');
  });

  it('adds nothing with box-sizing: content-box', () => {
    const element = iframe('border: 5px solid; padding: 5px');
    applySize(element, 100, 100);
    expect(element.style.height).toBe('100px');
  });

  it('works for an element in a document without a window', () => {
    const doc = document.implementation.createHTMLDocument('detached');
    const element = doc.createElement('iframe');
    applySize(element, 10, 20);
    expect(element.style.height).toBe('20px');
  });
});

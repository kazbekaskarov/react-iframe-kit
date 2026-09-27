import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mirrorStyles } from './styles';

let target: Document;
let stop: (() => void) | undefined;

beforeEach(() => {
  document.head.innerHTML = '';
  document.adoptedStyleSheets = [];
  target = document.implementation.createHTMLDocument('target');
});

afterEach(() => {
  stop?.();
  stop = undefined;
});

// Lets the MutationObserver deliver its records.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function style(css: string, attributes: Record<string, string> = {}): HTMLStyleElement {
  const element = document.createElement('style');
  element.textContent = css;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function link(href: string, rel = 'stylesheet'): HTMLLinkElement {
  const element = document.createElement('link');
  element.rel = rel;
  element.href = href;
  return element;
}

// The copied nodes in the target head, as comparable strings.
function copied(): string[] {
  return Array.from(target.head.childNodes).flatMap((node) => {
    if (node.nodeName === 'STYLE') return [`style:${node.textContent}`];
    if (node.nodeName === 'LINK') return [`link:${(node as HTMLLinkElement).getAttribute('href')}`];
    return [];
  });
}

describe('mirrorStyles', () => {
  it('copies existing styles and stylesheet links in source order', () => {
    document.head.append(
      style('a{}'),
      link('/one.css'),
      link('/icon.png', 'icon'),
      document.createElement('meta'),
      link('/two.css', 'preload stylesheet'),
    );

    stop = mirrorStyles(document, target);

    expect(copied()).toEqual(['style:a{}', 'link:/one.css', 'link:/two.css']);
  });

  it('places copies before the iframe’s own head content', () => {
    const own = target.createElement('style');
    own.textContent = 'own{}';
    target.head.append(own);
    document.head.append(style('copied{}'));

    stop = mirrorStyles(document, target);

    expect(copied()).toEqual(['style:copied{}', 'style:own{}']);
  });

  it('keeps attributes such as nonce', () => {
    document.head.append(style('a{}', { nonce: 'abc', media: 'print' }));

    stop = mirrorStyles(document, target);

    const copy = target.head.querySelector('style');
    expect(copy?.getAttribute('media')).toBe('print');
    expect(copy?.ownerDocument).toBe(target);
  });

  it('gives each copy the original nonce even when cloning drops it (Firefox)', () => {
    // A parsed nonce is hidden from the attribute and lives only in the `nonce` IDL
    // property; Firefox's importNode doesn't carry it into the other document.
    const original = style('a{}');
    original.nonce = 'secret';
    document.head.append(original);

    stop = mirrorStyles(document, target);

    expect(target.head.querySelector('style')?.nonce).toBe('secret');
  });

  it('mirrors styles added later, keeping source order', async () => {
    const first = style('first{}');
    const last = style('last{}');
    document.head.append(first, last);
    stop = mirrorStyles(document, target);

    document.head.insertBefore(style('middle{}'), last);
    document.head.append(style('appended{}'));
    await flush();

    expect(copied()).toEqual([
      'style:first{}',
      'style:middle{}',
      'style:last{}',
      'style:appended{}',
    ]);
  });

  it('removes copies of removed styles', async () => {
    const removed = style('removed{}');
    document.head.append(removed, style('kept{}'));
    stop = mirrorStyles(document, target);

    removed.remove();
    await flush();

    expect(copied()).toEqual(['style:kept{}']);
  });

  it('ignores a style that is added and removed before the observer runs', async () => {
    stop = mirrorStyles(document, target);

    const transient = style('transient{}');
    document.head.append(transient);
    transient.remove();
    await flush();

    expect(copied()).toEqual([]);
  });

  it('refreshes a copy when the text of a style changes', async () => {
    const element = style('old{}');
    document.head.append(element);
    stop = mirrorStyles(document, target);

    element.textContent = 'new{}';
    await flush();
    expect(copied()).toEqual(['style:new{}']);

    element.firstChild?.replaceWith(document.createTextNode('newer{}'));
    (element.firstChild as Text).data = 'newest{}';
    await flush();
    expect(copied()).toEqual(['style:newest{}']);
  });

  it('follows attribute changes that turn a link into a stylesheet and back', async () => {
    const element = link('/late.css', 'preload');
    document.head.append(element);
    stop = mirrorStyles(document, target);
    expect(copied()).toEqual([]);

    element.rel = 'stylesheet';
    await flush();
    expect(copied()).toEqual(['link:/late.css']);

    element.href = '/changed.css';
    await flush();
    expect(copied()).toEqual(['link:/changed.css']);

    element.rel = 'preload';
    await flush();
    expect(copied()).toEqual([]);
  });

  it('ignores changes to other head content', async () => {
    const meta = document.createElement('meta');
    document.head.append(meta);
    stop = mirrorStyles(document, target);

    meta.setAttribute('name', 'viewport');
    document.head.setAttribute('data-theme', 'dark');
    await flush();

    expect(copied()).toEqual([]);
  });

  it('works without adoptedStyleSheets support (Safari < 16.4)', () => {
    const source = document.implementation.createHTMLDocument('source');
    Object.defineProperty(source, 'adoptedStyleSheets', { value: undefined });
    source.head.append(source.createElement('style'));

    stop = mirrorStyles(source, document);

    expect(document.head.querySelectorAll('style')).toHaveLength(1);
  });

  it('copies adopted stylesheets into the target realm', () => {
    // The target needs a window to construct sheets in, so the global document is the
    // target here and a detached document is the source.
    const source = document.implementation.createHTMLDocument('source');
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.adopted { color: red; }');
    source.adoptedStyleSheets = [sheet];
    const own = new CSSStyleSheet();
    document.adoptedStyleSheets = [own];

    stop = mirrorStyles(source, document);

    expect(document.adoptedStyleSheets).toHaveLength(2);
    expect(document.adoptedStyleSheets[0]).not.toBe(sheet);
    expect(document.adoptedStyleSheets[0]?.cssRules[0]?.cssText).toContain('.adopted');
    expect(document.adoptedStyleSheets[1]).toBe(own);

    stop();
    stop = undefined;
    expect(document.adoptedStyleSheets).toEqual([own]);
  });

  it('skips adopted stylesheets when the target has no window', () => {
    const sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [sheet];
    expect(target.defaultView).toBeNull();

    stop = mirrorStyles(document, target);

    expect(target.adoptedStyleSheets).toEqual([]);
  });

  it('stops mirroring and removes every copy', async () => {
    document.head.append(style('a{}'));
    stop = mirrorStyles(document, target);

    stop();
    stop = undefined;
    document.head.append(style('b{}'));
    await flush();

    expect(copied()).toEqual([]);
    expect(target.head.childNodes).toHaveLength(0);
  });
});

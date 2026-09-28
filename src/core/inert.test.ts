import { afterEach, describe, expect, it } from 'vitest';
import { makeDocumentInert } from './inert';

afterEach(() => {
  document.body.removeAttribute('inert');
  document.body.innerHTML = '';
});

describe('makeDocumentInert', () => {
  it('makes the body inert, takes focus away, and undoes it', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    const undo = makeDocumentInert(document);
    expect(document.body.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).not.toBe(input);

    undo();
    expect(document.body.hasAttribute('inert')).toBe(false);
  });

  it('leaves a body that was already inert inert', () => {
    document.body.setAttribute('inert', '');
    makeDocumentInert(document)();
    expect(document.body.hasAttribute('inert')).toBe(true);
  });

  it('does nothing for a document without a body', () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.remove();
    expect(() => makeDocumentInert(doc)()).not.toThrow();
  });
});

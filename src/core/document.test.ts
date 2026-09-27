import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SRCDOC,
  isFinalDocument,
  isSandboxedWithoutSameOrigin,
  ROOT_MARKER,
} from './document';

function fakeDocument({
  readyState = 'complete',
  URL = 'about:srcdoc',
  marker = true,
  body = true,
}: {
  readyState?: string;
  URL?: string;
  marker?: boolean;
  body?: boolean;
} = {}): Document {
  const element = document.createElement('body');
  if (marker) element.setAttribute(ROOT_MARKER, '');
  return { readyState, URL, body: body ? element : null } as unknown as Document;
}

describe('DEFAULT_SRCDOC', () => {
  it('is a standards-mode document with a marked body', () => {
    expect(DEFAULT_SRCDOC.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(DEFAULT_SRCDOC).toContain(`<body ${ROOT_MARKER}>`);
  });
});

describe('isFinalDocument', () => {
  it('accepts the loaded default srcdoc document', () => {
    expect(isFinalDocument(fakeDocument(), false)).toBe(true);
  });

  it('rejects the initial about:blank document', () => {
    expect(isFinalDocument(fakeDocument({ URL: 'about:blank', marker: false }), false)).toBe(false);
  });

  it('rejects a document that is still loading', () => {
    expect(isFinalDocument(fakeDocument({ readyState: 'interactive' }), false)).toBe(false);
  });

  it('rejects a document without a body', () => {
    expect(isFinalDocument(fakeDocument({ body: false }), false)).toBe(false);
  });

  it('needs the marker only for the default srcdoc', () => {
    const custom = fakeDocument({ marker: false });
    expect(isFinalDocument(custom, false)).toBe(false);
    expect(isFinalDocument(custom, true)).toBe(true);
  });
});

describe('isSandboxedWithoutSameOrigin', () => {
  it.each([
    [null, false],
    ['', true],
    ['allow-scripts', true],
    ['allow-same-origin', false],
    ['allow-scripts allow-same-origin', false],
  ])('sandbox=%j → %s', (sandbox, expected) => {
    const iframe = document.createElement('iframe');
    if (sandbox !== null) iframe.setAttribute('sandbox', sandbox);
    expect(isSandboxedWithoutSameOrigin(iframe)).toBe(expected);
  });
});

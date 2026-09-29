import { afterEach, describe, expect, it, vi } from 'vitest';
import { IframeKitError } from './errors';
import {
  assertWildcardAllowed,
  deriveExpectedOrigin,
  normalizeOrigin,
  normalizeOriginMatchers,
  OPAQUE,
  originAllowed,
  sameOriginMatchers,
  WILDCARD,
} from './origin';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function expectInvalidOptions(fn: () => unknown): void {
  expect(fn).toThrow(IframeKitError);
  try {
    fn();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(IframeKitError);
    expect((error as IframeKitError).code).toBe('RIK_INVALID_OPTIONS');
  }
}

describe('normalizeOrigin', () => {
  it('canonicalizes case and drops a trailing slash', () => {
    expect(normalizeOrigin('https://Example.com/')).toBe('https://example.com');
  });

  it('keeps a non-default port', () => {
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('passes the sentinels "null" and "*" through unchanged', () => {
    expect(normalizeOrigin('null')).toBe(OPAQUE);
    expect(normalizeOrigin('*')).toBe(WILDCARD);
  });

  it('rejects a value with a path, query or hash', () => {
    for (const value of [
      'https://example.com/path',
      'https://example.com?q=1',
      'https://example.com#h',
    ]) {
      expect(() => normalizeOrigin(value)).toThrow(IframeKitError);
    }
  });

  it('rejects a value that is not a URL', () => {
    expectInvalidOptions(() => normalizeOrigin('not a url'));
  });

  it('treats an opaque URL (data:) as "null"', () => {
    expect(normalizeOrigin('data:text/plain,hi')).toBe(OPAQUE);
  });
});

describe('assertWildcardAllowed', () => {
  it('throws for "*" without the opt-in', () => {
    expectInvalidOptions(() => assertWildcardAllowed(WILDCARD, undefined, '`origin`'));
  });

  it('allows "*" with the opt-in', () => {
    expect(() => assertWildcardAllowed(WILDCARD, true, '`origin`')).not.toThrow();
  });

  it('never throws for a concrete origin', () => {
    expect(() => assertWildcardAllowed('https://example.com', false, '`origin`')).not.toThrow();
  });
});

describe('deriveExpectedOrigin', () => {
  // Not appended to the document: deriveExpectedOrigin only reads attributes, and an
  // attached iframe would make happy-dom actually try to fetch `src`.
  function iframe(attributes: Record<string, string> = {}): HTMLIFrameElement {
    const element = document.createElement('iframe');
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  it('is the page origin for srcdoc, even with a src set', () => {
    expect(deriveExpectedOrigin(iframe({ srcdoc: '<p>x</p>', src: 'https://example.com' }))).toBe(
      location.origin,
    );
  });

  it('is the page origin for about:blank or no src', () => {
    expect(deriveExpectedOrigin(iframe())).toBe(location.origin);
    expect(deriveExpectedOrigin(iframe({ src: 'about:blank' }))).toBe(location.origin);
  });

  it('is derived from an absolute cross-origin src', () => {
    expect(deriveExpectedOrigin(iframe({ src: 'https://widget.example.com/embed' }))).toBe(
      'https://widget.example.com',
    );
  });

  it('resolves a relative src against the page', () => {
    expect(deriveExpectedOrigin(iframe({ src: '/embed.html' }))).toBe(location.origin);
  });

  it('is "null" for an opaque src (data:)', () => {
    expect(deriveExpectedOrigin(iframe({ src: 'data:text/html,hi' }))).toBe(OPAQUE);
  });

  it('is "null" for a src that fails to parse even against the page as a base', () => {
    expect(deriveExpectedOrigin(iframe({ src: 'http://[' }))).toBe(OPAQUE);
  });

  it('does not auto-derive "null" from sandboxing: it reads the src, not runtime opacity', () => {
    const element = iframe({ src: 'https://example.com/x', sandbox: 'allow-scripts' });
    expect(deriveExpectedOrigin(element)).toBe('https://example.com');
  });
});

describe('originAllowed', () => {
  it('matches an exact string', () => {
    expect(originAllowed('https://a.example', ['https://a.example'])).toBe(true);
    expect(originAllowed('https://b.example', ['https://a.example'])).toBe(false);
  });

  it('matches a RegExp', () => {
    expect(originAllowed('https://a.example', [/^https:\/\/[a-z]\.example$/])).toBe(true);
  });

  it('the literal wildcard matches anything', () => {
    expect(originAllowed('https://anything.example', [WILDCARD])).toBe(true);
  });

  it('matches against any entry in the list', () => {
    expect(originAllowed('https://b.example', ['https://a.example', 'https://b.example'])).toBe(
      true,
    );
  });

  it('asks a predicate, and allows only on exactly `true`', () => {
    const tenants = new Set(['https://shop.example']);
    const isTenant = (origin: string) => tenants.has(origin);
    expect(originAllowed('https://shop.example', [isTenant])).toBe(true);
    expect(originAllowed('https://evil.example', [isTenant])).toBe(false);
    tenants.add('https://evil.example'); // asked on every handshake, not cached
    expect(originAllowed('https://evil.example', [isTenant])).toBe(true);
    // An async predicate returns a (truthy) Promise: that must not allow anything.
    const asyncPredicate = (async () => true) as unknown as (origin: string) => boolean;
    expect(originAllowed('https://shop.example', [asyncPredicate])).toBe(false);
  });
});

describe('normalizeOriginMatchers', () => {
  it('throws for an empty list', () => {
    expectInvalidOptions(() => normalizeOriginMatchers([], undefined));
  });

  it('normalizes string origins', () => {
    expect(normalizeOriginMatchers(['https://Example.com/'], undefined)).toEqual([
      'https://example.com',
    ]);
  });

  it('passes predicates through', () => {
    const predicate = (origin: string) => origin.endsWith('.example');
    expect(normalizeOriginMatchers([predicate], undefined)).toEqual([predicate]);
  });

  it('passes RegExp entries through', () => {
    const pattern = /^https:\/\/x$/;
    expect(normalizeOriginMatchers([pattern], undefined)).toEqual([pattern]);
  });

  it('requires the opt-in for a wildcard string entry', () => {
    expectInvalidOptions(() => normalizeOriginMatchers([WILDCARD], undefined));
    expect(normalizeOriginMatchers([WILDCARD], true)).toEqual([WILDCARD]);
  });

  it('rejects a stateful RegExp (g or y flag)', () => {
    expectInvalidOptions(() => normalizeOriginMatchers([/^x$/g], undefined));
    expectInvalidOptions(() => normalizeOriginMatchers([/^x$/y], undefined));
  });

  it('accepts an anchored RegExp without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeOriginMatchers([/^https:\/\/x$/], undefined)).toEqual([/^https:\/\/x$/]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once for an unanchored RegExp', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    normalizeOriginMatchers([/https:\/\/x/], undefined);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('sameOriginMatchers', () => {
  it('is true for equal sets regardless of order', () => {
    expect(sameOriginMatchers(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('is false for different lengths or values', () => {
    expect(sameOriginMatchers(['a'], ['a', 'b'])).toBe(false);
    expect(sameOriginMatchers(['a'], ['b'])).toBe(false);
  });

  it('compares predicates by identity', () => {
    const predicate = () => true;
    expect(sameOriginMatchers([predicate, 'a'], ['a', predicate])).toBe(true);
    expect(sameOriginMatchers([predicate], [() => true])).toBe(false);
  });

  it('compares RegExp by source and flags', () => {
    expect(sameOriginMatchers([/^a$/i], [/^a$/i])).toBe(true);
    expect(sameOriginMatchers([/^a$/i], [/^a$/])).toBe(false);
  });
});

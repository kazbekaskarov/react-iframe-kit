import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SRCDOC } from './document';
import { getRegistry } from './registry';
import { POLICY_NAME, setSrcDoc } from './srcdoc';

const KEY = Symbol.for('react-iframe-kit/v1');

/** Stands in for a browser `TrustedHTML`: an object that stringifies to its HTML. */
class FakeTrustedHTML {
  constructor(private readonly html: string) {}
  toJSON(): string {
    return this.html;
  }
  toString(): string {
    return this.html;
  }
}

type Rules = { createHTML(input: string): string };

function fakeFactory({ refuse = false } = {}) {
  const rules: Rules[] = [];
  const createPolicy = vi.fn((name: string, policyRules: Rules) => {
    if (refuse) throw new TypeError(`Policy "${name}" disallowed.`);
    rules.push(policyRules);
    return { createHTML: (input: string) => new FakeTrustedHTML(policyRules.createHTML(input)) };
  });
  return { createPolicy, rules };
}

/** Records what is assigned to `srcdoc`, and still stores it as the attribute. */
function recordingIframe() {
  const iframe = document.createElement('iframe');
  const assigned: unknown[] = [];
  Object.defineProperty(iframe, 'srcdoc', {
    configurable: true,
    set(value: unknown) {
      assigned.push(value);
      iframe.setAttribute('srcdoc', String(value));
    },
  });
  return { iframe, assigned };
}

const win = window as unknown as { trustedTypes?: unknown };

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

afterEach(() => {
  delete win.trustedTypes;
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe('setSrcDoc without Trusted Types', () => {
  it('assigns the default document as a string', () => {
    const { iframe, assigned } = recordingIframe();
    setSrcDoc(iframe, DEFAULT_SRCDOC);
    expect(assigned).toEqual([DEFAULT_SRCDOC]);
  });

  it('assigns a custom document as given', () => {
    const { iframe, assigned } = recordingIframe();
    const trusted = new FakeTrustedHTML('<p>custom</p>');
    setSrcDoc(iframe, '<p>plain</p>');
    setSrcDoc(iframe, trusted);
    expect(assigned).toEqual(['<p>plain</p>', trusted]);
  });

  it('does not reassign (and reload) a document the iframe already has', () => {
    const { iframe, assigned } = recordingIframe();
    iframe.setAttribute('srcdoc', '<p>same</p>');
    setSrcDoc(iframe, '<p>same</p>');
    setSrcDoc(iframe, new FakeTrustedHTML('<p>same</p>'));
    expect(assigned).toEqual([]);
  });

  it('handles an iframe whose document has no window', () => {
    const detached = document.implementation.createHTMLDocument('');
    const iframe = detached.createElement('iframe');
    setSrcDoc(iframe, DEFAULT_SRCDOC);
    expect(iframe.getAttribute('srcdoc')).toBe(DEFAULT_SRCDOC);
  });

  it('lets a blocked assignment throw', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'srcdoc', {
      set() {
        throw new TypeError('This document requires TrustedHTML assignment.');
      },
    });
    expect(() => setSrcDoc(iframe, '<p>custom</p>')).toThrow(/requires TrustedHTML/);
  });
});

describe('setSrcDoc with Trusted Types', () => {
  it('passes the default document through the library policy, created once', () => {
    const factory = fakeFactory();
    win.trustedTypes = factory;

    const first = recordingIframe();
    const second = recordingIframe();
    setSrcDoc(first.iframe, DEFAULT_SRCDOC);
    setSrcDoc(second.iframe, DEFAULT_SRCDOC);

    expect(factory.createPolicy).toHaveBeenCalledTimes(1);
    expect(factory.createPolicy).toHaveBeenCalledWith(POLICY_NAME, expect.anything());
    expect(first.assigned[0]).toBeInstanceOf(FakeTrustedHTML);
    expect(String(first.assigned[0])).toBe(DEFAULT_SRCDOC);
    expect(second.assigned[0]).toBeInstanceOf(FakeTrustedHTML);
  });

  it('has a policy that creates nothing but the default document', () => {
    const factory = fakeFactory();
    win.trustedTypes = factory;
    setSrcDoc(document.createElement('iframe'), DEFAULT_SRCDOC);

    const [rules] = factory.rules;
    expect(rules?.createHTML(DEFAULT_SRCDOC)).toBe(DEFAULT_SRCDOC);
    expect(() => rules?.createHTML('<script>alert(1)</script>')).toThrow(/not the default srcdoc/);
  });

  it('never uses the policy for a custom document', () => {
    const factory = fakeFactory();
    win.trustedTypes = factory;
    const { iframe, assigned } = recordingIframe();
    setSrcDoc(iframe, '<p>custom</p>');
    expect(factory.createPolicy).not.toHaveBeenCalled();
    expect(assigned).toEqual(['<p>custom</p>']);
  });

  it('falls back to a string when the page refuses the policy, and asks only once', () => {
    const factory = fakeFactory({ refuse: true });
    win.trustedTypes = factory;

    const first = recordingIframe();
    const second = recordingIframe();
    setSrcDoc(first.iframe, DEFAULT_SRCDOC);
    setSrcDoc(second.iframe, DEFAULT_SRCDOC);

    expect(factory.createPolicy).toHaveBeenCalledTimes(1);
    expect(first.assigned).toEqual([DEFAULT_SRCDOC]);
    expect(second.assigned).toEqual([DEFAULT_SRCDOC]);
  });

  it('reuses a policy another library copy created', () => {
    const factory = fakeFactory();
    win.trustedTypes = factory;
    const fromOtherCopy = { createHTML: () => new FakeTrustedHTML(DEFAULT_SRCDOC) };
    getRegistry().srcdocPolicies = new WeakMap([[factory, fromOtherCopy]]);

    const { iframe, assigned } = recordingIframe();
    setSrcDoc(iframe, DEFAULT_SRCDOC);

    expect(factory.createPolicy).not.toHaveBeenCalled();
    expect(assigned[0]).toBeInstanceOf(FakeTrustedHTML);
  });
});

/**
 * Puts a document into an iframe through its `srcdoc`, including on pages that enforce
 * Trusted Types. See docs/design.md → Trusted Types.
 */
import { DEFAULT_SRCDOC } from './document';
import { getRegistry } from './registry';

/**
 * A Trusted Types `TrustedHTML` value. Declared structurally, so the public types don't
 * require a `lib.dom` that knows `TrustedHTML` (TypeScript 5.6 doesn't).
 */
export interface TrustedHTMLLike {
  toJSON(): string;
}

/** The policy name a host allows in its `trusted-types` CSP directive. */
export const POLICY_NAME = 'react-iframe-kit';

interface Policy {
  createHTML(input: string): TrustedHTMLLike;
}

interface PolicyFactory {
  createPolicy(name: string, rules: { createHTML(input: string): string }): Policy;
}

/**
 * The library's policy for the Trusted Types factory of one window, or `null` when the
 * page refused it (a `trusted-types` directive that doesn't list the name). Shared by
 * library copies through the registry, since a policy name can only be created once.
 *
 * The policy creates exactly one document, `DEFAULT_SRCDOC`, which has no markup that
 * can run script; anything else is rejected. It never passes caller HTML through.
 */
function policyFor(factory: PolicyFactory): Policy | null {
  const registry = getRegistry();
  registry.srcdocPolicies ??= new WeakMap();
  const policies = registry.srcdocPolicies as WeakMap<PolicyFactory, Policy | null>;
  let policy = policies.get(factory);
  if (policy === undefined) {
    try {
      policy = factory.createPolicy(POLICY_NAME, {
        createHTML: (input) => {
          if (input !== DEFAULT_SRCDOC)
            throw new TypeError(`${POLICY_NAME}: not the default srcdoc`);
          return input;
        },
      });
    } catch {
      policy = null;
    }
    policies.set(factory, policy);
  }
  return policy;
}

/**
 * Sets `iframe.srcdoc` unless it already holds `srcDoc`, so a repeated call (StrictMode,
 * hydration of a server-set value) doesn't reload the iframe.
 *
 * The default document goes through the library's policy when the page has Trusted
 * Types. A custom document is assigned as given: under enforcement it must be a
 * `TrustedHTML` (or pass the page's `default` policy). Throws what the browser throws
 * when the page's policy blocks the assignment.
 */
export function setSrcDoc(iframe: HTMLIFrameElement, srcDoc: string | TrustedHTMLLike): void {
  if (iframe.getAttribute('srcdoc') === String(srcDoc)) return;
  let value: string | TrustedHTMLLike = srcDoc;
  if (srcDoc === DEFAULT_SRCDOC) {
    const factory = (iframe.ownerDocument.defaultView as { trustedTypes?: PolicyFactory } | null)
      ?.trustedTypes;
    const policy = factory ? policyFor(factory) : null;
    if (policy) value = policy.createHTML(DEFAULT_SRCDOC);
  }
  // `srcdoc` accepts TrustedHTML; lib.dom (and older TypeScript) types it as string.
  iframe.srcdoc = value as string;
}

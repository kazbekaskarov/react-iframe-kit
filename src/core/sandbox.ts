/**
 * A development check on iframe `sandbox` flags. See docs/design.md → Security.
 */
import { deriveExpectedOrigin } from './origin';

const warned = /* @__PURE__ */ new WeakSet<HTMLIFrameElement>();

/**
 * In development, warns once per iframe whose `sandbox` has both `allow-scripts` and
 * `allow-same-origin` while its content is on this page's origin: the framed script can
 * then remove the sandbox, so it protects nothing. (On another origin the pair is fine:
 * "same origin" means the content's own.)
 */
export function warnIneffectiveSandbox(iframe: HTMLIFrameElement): void {
  /* v8 ignore next: __DEV__ is compile-time and `true` in tests. */
  if (!__DEV__) return;
  if (warned.has(iframe) || !iframe.hasAttribute('sandbox')) return;
  const { sandbox } = iframe;
  if (!sandbox.contains('allow-scripts') || !sandbox.contains('allow-same-origin')) return;
  if (deriveExpectedOrigin(iframe) !== location.origin) return;
  warned.add(iframe);
  console.warn(
    "react-iframe-kit: this iframe's `sandbox` has both `allow-scripts` and `allow-same-origin`, and its content is on this page's origin, so the framed script can remove the sandbox: it protects nothing. Serve untrusted content from another origin, or drop one of the flags.",
    iframe,
  );
}

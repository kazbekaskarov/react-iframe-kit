/**
 * Origin handling for the handshake. See docs/design.md → Security.
 */
import { IframeKitError } from './errors';

/**
 * An exact origin, a `RegExp` tested against the origin, or a predicate. A predicate
 * allows an origin only when it returns exactly `true`, so an async one (a `Promise`)
 * allows nothing. See docs/design.md → Security.
 */
export type OriginMatcher = string | RegExp | ((origin: string) => boolean);

/** A wildcard requires an explicit `unsafeAllowAnyOrigin: true` opt-in. */
export const WILDCARD = '*';
/** An opaque origin (sandboxed without `allow-same-origin`, `data:`/`javascript:` URLs). */
export const OPAQUE = 'null';

/**
 * Normalizes an explicit origin option with `new URL(value).origin`, so
 * `https://Example.com/` equals `https://example.com`. The sentinels `'null'` and
 * `'*'` pass through unchanged (callers that reject/require an opt-in for the
 * wildcard do so separately, with `assertWildcardAllowed`). Throws
 * `RIK_INVALID_OPTIONS` for anything else that isn't a valid origin (a value with a
 * path, query or hash, or one that isn't a URL at all).
 */
export function normalizeOrigin(value: string): string {
  if (value === OPAQUE || value === WILDCARD) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IframeKitError(
      'RIK_INVALID_OPTIONS',
      `react-iframe-kit: "${value}" is not a valid origin.`,
    );
  }
  if (url.origin === 'null') return OPAQUE; // opaque URL (data:, javascript:, file:): no path/query/hash check applies
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new IframeKitError(
      'RIK_INVALID_OPTIONS',
      `react-iframe-kit: "${value}" is not a valid origin (it has a path, query or hash). Use just the scheme, host and port, e.g. "https://example.com".`,
    );
  }
  return url.origin;
}

/** Throws `RIK_INVALID_OPTIONS` if `origin` is the wildcard without the opt-in. */
export function assertWildcardAllowed(
  origin: string,
  unsafeAllowAnyOrigin: boolean | undefined,
  where: string,
): void {
  if (origin === WILDCARD && !unsafeAllowAnyOrigin) {
    throw new IframeKitError(
      'RIK_INVALID_OPTIONS',
      `react-iframe-kit: ${where} is "*", which allows any origin. Set \`unsafeAllowAnyOrigin: true\` to confirm this is intended.`,
    );
  }
}

/**
 * The parent's expected origin for an iframe, re-derived on every handshake attempt
 * since the iframe may navigate. See docs/design.md → Security.
 */
export function deriveExpectedOrigin(iframe: HTMLIFrameElement): string {
  if (iframe.hasAttribute('srcdoc')) return location.origin;
  const src = iframe.getAttribute('src');
  if (!src || src === 'about:blank') return location.origin;
  try {
    const origin = new URL(src, document.baseURI).origin;
    return origin === '' || origin === 'null' ? OPAQUE : origin;
  } catch {
    return OPAQUE;
  }
}

/** Whether `actual` (a `MessageEvent.origin`) satisfies one of `matchers`. */
export function originAllowed(actual: string, matchers: readonly OriginMatcher[]): boolean {
  return matchers.some((matcher) =>
    typeof matcher === 'string'
      ? matcher === WILDCARD || matcher === actual
      : typeof matcher === 'function'
        ? matcher(actual) === true
        : matcher.test(actual),
  );
}

/**
 * Validates and normalizes `allowedOrigins` (the child's option, but reused wherever a
 * list of origin matchers is accepted). Throws `RIK_INVALID_OPTIONS` for an empty list,
 * an un-opted-in wildcard, or a stateful (`g`/`y`) `RegExp`. In dev, warns once per
 * unanchored `RegExp`.
 */
export function normalizeOriginMatchers(
  matchers: readonly OriginMatcher[],
  unsafeAllowAnyOrigin: boolean | undefined,
): OriginMatcher[] {
  if (matchers.length === 0) {
    throw new IframeKitError(
      'RIK_INVALID_OPTIONS',
      'react-iframe-kit: `allowedOrigins` must not be empty.',
    );
  }
  return matchers.map((matcher) => {
    if (typeof matcher === 'function') return matcher;
    if (typeof matcher !== 'string') {
      if (matcher.flags.includes('g') || matcher.flags.includes('y')) {
        throw new IframeKitError(
          'RIK_INVALID_OPTIONS',
          `react-iframe-kit: the RegExp ${matcher} in \`allowedOrigins\` must not have the \`g\` or \`y\` flag (its \`test()\` would then be stateful).`,
        );
      }
      if (__DEV__ && !(matcher.source.startsWith('^') && matcher.source.endsWith('$'))) {
        console.warn(
          `react-iframe-kit: the RegExp ${matcher} in \`allowedOrigins\` is not anchored with ^…$, so it may match more than intended.`,
        );
      }
      return matcher;
    }
    assertWildcardAllowed(matcher, unsafeAllowAnyOrigin, '`allowedOrigins`');
    return matcher === WILDCARD ? matcher : normalizeOrigin(matcher);
  });
}

/**
 * Whether two origin-matcher lists are equal as sets, order aside. Predicates are
 * equal only to themselves: two callers must pass the same function.
 */
export function sameOriginMatchers(
  a: readonly OriginMatcher[],
  b: readonly OriginMatcher[],
): boolean {
  if (a.length !== b.length) return false;
  const key = (m: OriginMatcher) =>
    typeof m === 'string' ? `s:${m}` : typeof m === 'function' ? m : `r:${m.source}:${m.flags}`;
  const bKeys = new Set(b.map(key));
  return a.every((m) => bKeys.has(key(m)));
}

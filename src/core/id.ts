/**
 * A short id unique enough to correlate a handshake session within one page's
 * lifetime. Not a secret: it travels in cleartext over `postMessage`, visible to
 * anyone listening on the page.
 */
export function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

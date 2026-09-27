/**
 * `debug: true` logs all protocol traffic to the console. See docs/design.md →
 * Errors. Shared by both connection sides so the format matches.
 */
export function logProtocolMessage(enabled: boolean, direction: '→' | '←', message: unknown): void {
  if (enabled) console.debug(`react-iframe-kit ${direction}`, message);
}

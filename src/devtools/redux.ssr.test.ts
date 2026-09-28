// @vitest-environment node
import { expect, it } from 'vitest';
import { connectReduxDevTools } from './redux';

it('does nothing on the server', () => {
  expect(typeof window).toBe('undefined');
  expect(() => connectReduxDevTools()()).not.toThrow();
});

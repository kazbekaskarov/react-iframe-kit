import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Frame } from './Frame';

// docs/design.md → `<Frame>`: dev warnings for the iframe's accessible name and
// keyboard reachability.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const warnings = (warn: ReturnType<typeof spyWarn>) =>
  warn.mock.calls.map(([message]) => String(message));

describe('<Frame> accessibility warnings', () => {
  it('stays quiet for a descriptive, unique title', () => {
    const warn = spyWarn();
    render(
      <StrictMode>
        <Frame title="Order summary" />
        <Frame title="Shipping address" />
      </StrictMode>,
    );
    expect(warnings(warn)).toEqual([]);
  });

  it('warns once about a missing title, even in StrictMode and across renders', () => {
    const warn = spyWarn();
    const { rerender } = render(
      <StrictMode>
        <Frame />
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Frame className="changed" />
      </StrictMode>,
    );
    expect(warnings(warn)).toEqual([
      expect.stringMatching(/^react-iframe-kit: <Frame> has no `title`/),
    ]);
  });

  it('warns about a generic title and a negative tabIndex', () => {
    const warn = spyWarn();
    render(<Frame title="iframe" tabIndex={-1} />);
    expect(warnings(warn)).toEqual([
      expect.stringContaining('has a generic `title` ("iframe")'),
      expect.stringContaining('has a negative `tabIndex`'),
    ]);
  });

  it('warns when two mounted frames share a title, and not after one unmounts', () => {
    const warn = spyWarn();
    const { rerender } = render(
      <>
        <Frame title="Preview" />
        <Frame title="Preview" />
      </>,
    );
    expect(warnings(warn)).toEqual([
      expect.stringContaining('has the same `title` ("Preview") as another mounted <Frame>'),
    ]);

    warn.mockClear();
    rerender(<Frame title="Preview" />);
    rerender(
      <>
        <Frame title="Preview" />
        <Frame title="Other" />
      </>,
    );
    expect(warnings(warn)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { measureDocument } from './measure';

interface Layout {
  rect: { width: number; height: number };
  client: { width: number; height: number };
  scroll?: { width: number; height: number };
  inner?: { width: number; height: number } | null;
}

// happy-dom doesn't lay out, so the layout numbers are provided explicitly.
function fakeDocument({ rect, client, scroll = client, inner = client }: Layout): Document {
  const documentElement = {
    getBoundingClientRect: () => rect,
    clientWidth: client.width,
    clientHeight: client.height,
    scrollWidth: scroll.width,
    scrollHeight: scroll.height,
  };
  const defaultView = inner ? { innerWidth: inner.width, innerHeight: inner.height } : null;
  return { documentElement, defaultView } as unknown as Document;
}

describe('measureDocument', () => {
  it('returns null for a document that is not rendered', () => {
    const doc = fakeDocument({ rect: { width: 0, height: 0 }, client: { width: 0, height: 0 } });
    expect(measureDocument(doc)).toBeNull();
  });

  it('measures <html> and rounds up', () => {
    const doc = fakeDocument({
      rect: { width: 300, height: 120.2 },
      client: { width: 300, height: 150 },
      inner: { width: 300, height: 150 },
    });
    expect(measureDocument(doc)).toEqual({
      width: 300,
      height: 121,
      viewport: { width: 300, height: 150 },
      overflow: false,
      viewportBoundWidth: true,
    });
  });

  it('can shrink below the viewport (scroll size never drops below it)', () => {
    const doc = fakeDocument({
      rect: { width: 300, height: 40 },
      client: { width: 300, height: 400 },
      scroll: { width: 300, height: 400 },
    });
    expect(measureDocument(doc)?.height).toBe(40);
  });

  it('uses the scroll size when content overflows <html>', () => {
    const doc = fakeDocument({
      rect: { width: 280, height: 150 },
      client: { width: 285, height: 150 },
      scroll: { width: 500, height: 900 },
    });
    const measurement = measureDocument(doc);
    expect(measurement).toMatchObject({ width: 500, height: 900, overflow: true });
    expect(measurement?.viewportBoundWidth).toBe(false);
  });

  it('uses the viewport from clientWidth/Height without a window', () => {
    const doc = fakeDocument({
      rect: { width: 200, height: 100 },
      client: { width: 210, height: 110 },
      inner: null,
    });
    expect(measureDocument(doc)?.viewport).toEqual({ width: 210, height: 110 });
  });

  it('uses a custom measure function, rounded up', () => {
    const doc = fakeDocument({
      rect: { width: 1, height: 1 },
      client: { width: 300, height: 150 },
    });
    expect(measureDocument(doc, () => ({ width: 10.1, height: 20.5 }))).toEqual({
      width: 11,
      height: 21,
      viewport: { width: 300, height: 150 },
      overflow: false,
      viewportBoundWidth: false,
    });
  });
});

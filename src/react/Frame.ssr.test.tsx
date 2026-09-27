// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useFrame } from './context';
import { Frame } from './Frame';

// docs/design.md → SSR: nothing touches `document` on the server.
describe('server rendering', () => {
  it('renders <Frame> as an empty iframe, leaving srcdoc to the client', () => {
    expect(typeof document).toBe('undefined');

    const html = renderToString(
      <Frame title="preview" className="frame" copyStyles head={<style>{'p{}'}</style>}>
        <p>content</p>
      </Frame>,
    );

    expect(html).toMatch(/^<iframe [^>]*title="preview"/);
    expect(html).toContain('class="frame"');
    expect(html).not.toContain('content');
    // Set on the client, where it can go through a Trusted Types policy.
    expect(html.toLowerCase()).not.toContain('srcdoc');
  });

  it('leaves a custom srcDoc to the client too', () => {
    const html = renderToString(<Frame title="custom" srcDoc="<p>custom</p>" />);
    expect(html.toLowerCase()).not.toContain('srcdoc');
  });

  it('gives useFrame null window and document outside a <Frame>', () => {
    function Probe() {
      const frame = useFrame();
      return <span>{`${frame.window === null}:${frame.document === null}`}</span>;
    }
    expect(renderToString(<Probe />)).toBe('<span>true:true</span>');
  });
});

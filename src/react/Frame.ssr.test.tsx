// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ROOT_MARKER } from '../core/document';
import { useFrame } from './context';
import { Frame } from './Frame';

// docs/design.md → SSR: nothing touches `document` on the server.
describe('server rendering', () => {
  it('renders <Frame> as an empty iframe with the default srcdoc', () => {
    expect(typeof document).toBe('undefined');

    const html = renderToString(
      <Frame title="preview" className="frame" copyStyles head={<style>{'p{}'}</style>}>
        <p>content</p>
      </Frame>,
    );

    expect(html).toMatch(/^<iframe [^>]*title="preview"/);
    expect(html).toContain('class="frame"');
    expect(html).toContain(ROOT_MARKER);
    expect(html).not.toContain('content');
  });

  it('renders a custom srcDoc', () => {
    const html = renderToString(<Frame title="custom" srcDoc="<p>custom</p>" />);
    expect(html).toContain('srcDoc="&lt;p&gt;custom&lt;/p&gt;"');
  });

  it('gives useFrame null window and document outside a <Frame>', () => {
    function Probe() {
      const frame = useFrame();
      return <span>{`${frame.window === null}:${frame.document === null}`}</span>;
    }
    expect(renderToString(<Probe />)).toBe('<span>true:true</span>');
  });
});

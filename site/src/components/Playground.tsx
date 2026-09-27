// Live sandbox: edit the markup and styles, and <Frame resize> renders them into a real
// iframe and follows the content's height. Everything runs in your own browser.
import { useState } from 'react';
import { Frame, type Size } from 'react-iframe-kit';

const INITIAL_HTML = `<h1>Hello from inside the iframe</h1>
<p>Edit this markup: the iframe follows the content's height.</p>
<details>
  <summary>Open me</summary>
  <p>Opening this grows the document; closing it shrinks it again.</p>
</details>`;

const INITIAL_CSS = `body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
h1 { font-size: 1.4rem; margin: 0 0 8px; }`;

const field: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--sl-font-mono, monospace)',
  fontSize: '0.85rem',
  padding: '0.5rem',
  boxSizing: 'border-box',
};

export default function Playground() {
  const [html, setHtml] = useState(INITIAL_HTML);
  const [css, setCss] = useState(INITIAL_CSS);
  const [maxHeight, setMaxHeight] = useState<number | ''>('');
  const [size, setSize] = useState<Size | null>(null);

  return (
    <div className="not-content" style={{ display: 'grid', gap: '1rem' }}>
      <label>
        <strong>HTML</strong>
        <textarea
          style={field}
          rows={8}
          value={html}
          spellCheck={false}
          onChange={(event) => setHtml(event.target.value)}
        />
      </label>
      <label>
        <strong>CSS</strong>
        <textarea
          style={field}
          rows={4}
          value={css}
          spellCheck={false}
          onChange={(event) => setCss(event.target.value)}
        />
      </label>
      <label>
        <strong>maxHeight</strong> (px, empty for none){' '}
        <input
          type="number"
          min={0}
          value={maxHeight}
          onChange={(event) =>
            setMaxHeight(event.target.value === '' ? '' : Number(event.target.value))
          }
        />
      </label>
      <Frame
        title="Playground output"
        style={{ width: '100%', border: '1px solid var(--sl-color-gray-5, #ccc)' }}
        head={<style>{css}</style>}
        resize={{ maxHeight: maxHeight === '' ? undefined : maxHeight, onResize: setSize }}
      >
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the point of the playground; it renders what you type, in your own browser only */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </Frame>
      <output>Content size: {size ? `${size.width} × ${size.height}px` : 'measuring…'}</output>
    </div>
  );
}

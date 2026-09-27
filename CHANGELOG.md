# react-iframe-kit

## 0.1.0

### Minor Changes

- 5d29d5d: Add `<Frame>`, `useIframe` and `useFrame` for rendering React children into a same-origin iframe. Content is mounted only into the iframe's final, standards-mode document, so it never disappears when the document is replaced on load (facebook/react#22847), and it is remounted after every reload. `<Frame>` supports `head`, `copyStyles` (mirrors parent styles, including ones added later) and a custom `srcDoc`.

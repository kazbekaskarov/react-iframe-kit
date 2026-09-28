// A real cross-origin page: connects to whichever parent framed it (any origin, since
// the e2e harness's two ports vary run to run) and reports its own content size.
// `?lite` connects through `react-iframe-kit/child/lite` (no RPC) instead of the full
// `react-iframe-kit/child`. See e2e/cross-origin-resize.spec.ts.
export {}; // a module, for the top-level await

const lite = new URLSearchParams(location.search).has('lite');
const { connectToParent } = lite
  ? await import('react-iframe-kit/child/lite')
  : await import('react-iframe-kit/child');

connectToParent({
  allowedOrigins: [/^http:\/\/127\.0\.0\.1:\d+$/],
  autoResize: true,
});

// Exposed for the test to grow/shrink the content without a full page reload.
Object.assign(window, {
  addLine() {
    const line = document.createElement('p');
    line.textContent = 'more';
    document.getElementById('content')?.append(line);
  },
});

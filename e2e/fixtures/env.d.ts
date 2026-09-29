// The host `<script>` build as text (e2e/vite.config.ts aliases it to dist/), run as a
// classic script by host-vanilla.ts.
declare module 'kit-host-iife?raw' {
  const code: string;
  export default code;
}

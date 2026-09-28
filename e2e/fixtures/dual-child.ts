// Child half of e2e/dual.spec.ts: both copies call connectToParent, and must end up
// on the page's single connection.
import type { ChildModule, ChildSide, ParentSide } from './dual-contract';

export function startChild(esm: ChildModule, cjs: ChildModule): void {
  const allowedOrigins = [/^http:\/\/127\.0\.0\.1:\d+$/];
  const viaCjs = cjs.connectToParent<ParentSide, ChildSide>({
    allowedOrigins,
    autoResize: true,
    methods: { add: (a, b) => a + b },
  });
  const viaEsm = esm.connectToParent<ParentSide, ChildSide>({
    allowedOrigins,
    methods: {
      multiply: (a, b) => a * b,
      fail: () => {
        throw new Error('nope');
      },
    },
  });
  viaEsm.remote.getName().then((name) => {
    const output = document.getElementById('parent-name');
    if (output) output.textContent = name;
    viaCjs.emit('pinged');
  });
}

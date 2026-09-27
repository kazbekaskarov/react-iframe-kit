// Child half of the version-skew pair. See skew-contract.ts.
import type { ChildModule, ChildSide, ParentSide } from './skew-contract';

export function startChild(kit: ChildModule): void {
  const parent = kit.connectToParent<ParentSide, ChildSide>({
    allowedOrigins: [/^http:\/\/127\.0\.0\.1:\d+$/],
    autoResize: true,
    methods: { add: (a, b) => a + b },
  });
  parent.remote.getName().then((name) => {
    const output = document.getElementById('parent-name');
    if (output) output.textContent = name;
    parent.emit('pinged');
  });
}

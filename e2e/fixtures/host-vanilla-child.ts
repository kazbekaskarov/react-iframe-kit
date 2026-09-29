// The widget inside the vanilla host (e2e/host.spec.ts): plain `connectToParent`.
import { connectToParent } from 'react-iframe-kit/child';
import type { ChildSide, HostSide } from './host-vanilla-contract';

const parent = connectToParent<HostSide, ChildSide>({
  allowedOrigins: [/^http:\/\/127\.0\.0\.1:\d+$/],
  methods: { add: (a, b) => a + b },
  autoResize: true,
  syncTitle: true,
});

parent.remote.getUser(7).then((user) => {
  (document.querySelector('[data-testid="user"]') as HTMLElement).textContent = user.name;
});

document.getElementById('submit')?.addEventListener('click', () => {
  parent.emit('submitted', { id: '42' });
});

Object.assign(window, {
  addLine() {
    const line = document.createElement('p');
    line.textContent = 'more';
    document.getElementById('content')?.append(line);
  },
  rename(title: string) {
    document.title = title;
  },
});

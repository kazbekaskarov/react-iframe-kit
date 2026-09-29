// A host page that doesn't use the library at all: connect-widget.js, the hand-written
// protocol from the docs, against the library's widget. `?child=published` embeds the
// last published widget instead (e2e/skew.spec.ts); `?late` connects only once the
// widget has loaded, so it must answer the host's prompt. See e2e/manual-host.spec.ts.
import { CHILD_ORIGIN } from '../origins';
import { connectWidget } from './connect-widget.js';

const output = (id) => document.querySelector(`[data-testid="${id}"]`);
const params = new URLSearchParams(location.search);
const published = params.get('child') === 'published';

const iframe = document.querySelector('iframe');
iframe.src = `${CHILD_ORIGIN}/${published ? 'skew-published-child.html' : 'host-vanilla-child.html'}`;

if (params.has('late')) await new Promise((resolve) => iframe.addEventListener('load', resolve));

const events = [];
let connects = 0;
const widget = connectWidget(iframe, {
  origin: CHILD_ORIGIN,
  methods: {
    getUser: (id) => ({ name: `user ${id}` }),
    getName: () => 'parent',
    fail: () => {
      throw Object.assign(new Error('declined'), { code: 'CARD_DECLINED' });
    },
  },
  onEvent: (name, payload) => {
    events.push(payload === undefined ? name : `${name} ${JSON.stringify(payload)}`);
    output('events').textContent = events.join(', ');
  },
  onStatus: (status) => {
    output('status').textContent = status;
    if (status === 'connected') output('connects').textContent = String(++connects);
  },
});

const click = (id, handler) => document.getElementById(id)?.addEventListener('click', handler);
click('add', async () => {
  output('result').textContent = String(await widget.call('add', 2, 3));
});
click('missing', () => {
  widget.call('missing').catch((error) => {
    output('error').textContent = `${error.name} ${error.code}: ${error.message}`;
  });
});
let inert = false;
click('inert', () => {
  inert = !inert;
  widget.setInert(inert);
});
click('theme', () => widget.emit('theme', 'dark'));

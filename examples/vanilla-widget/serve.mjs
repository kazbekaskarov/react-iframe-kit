// Two origins on localhost, no dependencies: the customer's site on :8080 and the ticket
// vendor on :8081, which serves the widget, its loader, and react-iframe-kit's
// `<script>` builds from its own origin (self-hosted, like Stripe's or Tito's scripts).
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kit = join(
  dirname(createRequire(import.meta.url).resolve('react-iframe-kit/package.json')),
  'dist',
);

export const CUSTOMER_PORT = Number(process.env.CUSTOMER_PORT ?? 8080);
export const VENDOR_PORT = Number(process.env.VENDOR_PORT ?? 8081);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };

function serve(port, routes) {
  createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = routes(path);
    try {
      const body = await readFile(file ?? '');
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        ...(port === VENDOR_PORT && path.startsWith('/embed')
          ? // Who may frame the widget. A real vendor computes this per tenant.
            { 'content-security-policy': `frame-ancestors http://localhost:${CUSTOMER_PORT}` }
          : {}),
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  }).listen(port, 'localhost', () => console.log(`http://localhost:${port}/`));
}

serve(CUSTOMER_PORT, (path) => (path === '/' ? join(here, 'customer.html') : undefined));
serve(VENDOR_PORT, (path) => {
  if (path === '/loader.js') return join(here, 'loader.js');
  if (path.startsWith('/embed/')) return join(here, 'widget.html');
  const script = /^\/vendor\/((?:child|host)\.global\.js(?:\.map)?)$/.exec(path)?.[1];
  return script ? join(kit, script) : undefined;
});

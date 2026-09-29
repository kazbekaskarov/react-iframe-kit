# A white-label widget on a site without React

The ticket-shop case from [Embedding a widget](https://kazbekaskarov.github.io/react-iframe-kit/guides/embedding/),
with no framework and no build step on either side:

- `customer.html` is the customer's site (http://localhost:8080). It pastes the vendor's
  snippet: an element that marks the spot, a command queue, and the async loader.
- `loader.js` is the vendor's loader (http://localhost:8081). It loads
  `react-iframe-kit/host`'s `<script>` build, creates an iframe per `[data-tickets]`
  element, connects with `connectToIframe` (resize, title, a `getToken` method, a link
  instead of the widget when it doesn't answer), and runs the queued commands.
- `widget.html` is the widget, framed from the vendor's origin. It uses the child
  `<script>` build: `connectToParent` with a predicate over the tenant's origins,
  `autoResize`, `syncTitle`, a `prefill` method that refuses once checkout has started,
  and an `orderCompleted` event.
- `serve.mjs` serves both origins, the library's builds from the vendor's own origin (as
  vendors self-host their scripts), and `frame-ancestors` on the widget.

```sh
npm install
npm start
# open http://localhost:8080/
```

A production loader would bundle `react-iframe-kit/host` rather than load a second
script, and would be versioned (`/v1/loader.js`), since customers never update what
they paste.

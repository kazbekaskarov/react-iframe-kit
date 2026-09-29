// The vendor's loader, served from the vendor's origin. It loads react-iframe-kit's host
// build, puts an iframe into every `[data-tickets]` element, connects to it, and runs the
// commands the page queued before this script arrived. A production loader would bundle
// `react-iframe-kit/host` instead of loading a second script.
(() => {
  const VENDOR = new URL(document.currentScript.src).origin;
  const widgets = [];

  function mount(element) {
    const iframe = document.createElement('iframe');
    iframe.src = `${VENDOR}/embed/${encodeURIComponent(element.dataset.tenant)}`;
    iframe.title = element.dataset.title || 'Tickets';
    iframe.allow = 'payment';
    iframe.style.cssText = 'width: 100%; border: 0; display: block';
    element.replaceChildren(iframe);

    const widget = ReactIframeKitHost.connectToIframe(iframe, {
      resize: { maxHeight: 4000 },
      syncTitle: true,
      connectTimeout: 15000,
      methods: {
        // A short-lived token from the customer's backend, for the widget's API calls.
        getToken: () => `token-${Date.now()}`,
      },
      onStatusChange(status) {
        if (status !== 'timeout') return;
        // The widget didn't answer: link to its own page instead.
        const link = document.createElement('a');
        link.href = iframe.src;
        link.textContent = 'Buy tickets';
        element.replaceChildren(link);
      },
    });
    widgets.push(widget);
  }

  function run(command) {
    const [name, ...args] = command;
    for (const widget of widgets) {
      if (name === 'on') widget.on(args[0], args[1]);
      // Refused (false) once checkout has started; a real loader might tell the page.
      else if (name === 'prefill') widget.remote.prefill(args[0]);
    }
  }

  const script = document.createElement('script');
  script.src = `${VENDOR}/vendor/host.global.js`;
  script.onload = () => {
    document.querySelectorAll('[data-tickets]').forEach(mount);
    const queued = window.tickets?.q || [];
    window.tickets = (...command) => run(command);
    for (const command of queued) run(command);
  };
  document.head.append(script);
})();

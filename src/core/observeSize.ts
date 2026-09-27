import { type MeasureFn, type Measurement, measureDocument } from './measure';

/**
 * Watches a document's content size. See docs/design.md → Resize → Measurement.
 *
 * Triggers are batched to one measurement per animation frame, with a timer fallback
 * because rAF is paused in hidden and `display: none` iframes. Unrendered (0 × 0)
 * and unchanged sizes are not reported.
 *
 * @returns a function that stops observing.
 */
export function observeSize(
  doc: Document,
  onSize: (measurement: Measurement) => void,
  measure?: MeasureFn,
): () => void {
  const view = doc.defaultView;
  if (!view) return () => {};

  let last: Measurement | undefined;
  let frame: number | undefined;
  let timer: number | undefined;

  const run = () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    if (timer !== undefined) view.clearTimeout(timer);
    frame = undefined;
    timer = undefined;

    const next = measureDocument(doc, measure);
    if (!next) return;
    if (last && last.width === next.width && last.height === next.height) return;
    last = next;
    onSize(next);
  };

  const schedule = () => {
    if (frame !== undefined || timer !== undefined) return;
    frame = view.requestAnimationFrame(run);
    timer = view.setTimeout(run, 100);
  };

  // The document's own realm: the parent may be observing an iframe's document.
  const resizeObserver = new view.ResizeObserver(schedule);
  resizeObserver.observe(doc.documentElement);
  if (doc.body) resizeObserver.observe(doc.body);

  const mutationObserver = new view.MutationObserver(schedule);
  mutationObserver.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  const events = ['load', 'transitionend', 'animationend'] as const;
  for (const type of events) doc.addEventListener(type, schedule, true);
  doc.fonts?.addEventListener('loadingdone', schedule);

  run();

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    for (const type of events) doc.removeEventListener(type, schedule, true);
    doc.fonts?.removeEventListener('loadingdone', schedule);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    if (timer !== undefined) view.clearTimeout(timer);
  };
}

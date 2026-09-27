/**
 * `copyStyles`: mirrors the parent document's stylesheets into an iframe document.
 * See docs/design.md → `<Frame>`.
 *
 * Nodes are copied with `importNode`, which keeps the `nonce` a strict host CSP needs
 * (the srcdoc document inherits the host's CSP). Known limits:
 * - rules added through CSSOM (`sheet.insertRule`, e.g. emotion's "speedy" mode) are
 *   not visible to a MutationObserver and aren't mirrored; point the CSS-in-JS library
 *   at the iframe document instead;
 * - `adoptedStyleSheets` are copied once, when mirroring starts.
 */

type StyleNode = HTMLStyleElement | HTMLLinkElement;

// nodeName instead of instanceof: nodes may come from another realm.
function isStyleNode(node: Node): node is StyleNode {
  if (node.nodeName === 'STYLE') return true;
  return node.nodeName === 'LINK' && /(^|\s)stylesheet(\s|$)/i.test((node as HTMLLinkElement).rel);
}

type WindowWithCSSOM = Window & typeof globalThis;

/**
 * Starts mirroring `<style>` and `<link rel="stylesheet">` children of `source.head`
 * (and its adopted stylesheets) into `target.head`. Copies are placed at the start of
 * the target head, in source order, so the iframe's own head content wins the cascade.
 *
 * @returns a function that stops mirroring and removes the copies.
 */
export function mirrorStyles(source: Document, target: Document): () => void {
  const copies = new Map<Node, Node>();
  const end = target.createComment('react-iframe-kit: copied styles end');
  target.head.prepend(end);

  const copy = (original: StyleNode) => target.importNode(original, true);

  const add = (original: StyleNode) => {
    // Insert before the copy of the next copied sibling to keep source order.
    let before: Node = end;
    for (let next = original.nextSibling; next; next = next.nextSibling) {
      const nextCopy = copies.get(next);
      if (nextCopy) {
        before = nextCopy;
        break;
      }
    }
    const clone = copy(original);
    target.head.insertBefore(clone, before);
    copies.set(original, clone);
  };

  const remove = (original: Node) => {
    (copies.get(original) as ChildNode | undefined)?.remove();
    copies.delete(original);
  };

  const refresh = (original: Node) => {
    const current = copies.get(original) as ChildNode | undefined;
    if (!current) {
      if (original.parentNode === source.head && isStyleNode(original)) add(original);
      return;
    }
    if (!isStyleNode(original)) {
      remove(original);
      return;
    }
    const clone = copy(original);
    current.replaceWith(clone);
    copies.set(original, clone);
  };

  // The direct child of <head> that contains `node`, if any.
  const headChildOf = (node: Node): Node | null => {
    let current: Node | null = node;
    while (current && current.parentNode !== source.head) current = current.parentNode;
    return current;
  };

  for (const child of Array.from(source.head.childNodes)) {
    if (isStyleNode(child)) add(child);
  }

  const observer = new MutationObserver((records) => {
    const changed = new Set<Node>();
    for (const record of records) {
      if (record.type === 'childList' && record.target === source.head) {
        for (const node of Array.from(record.removedNodes)) remove(node);
        for (const node of Array.from(record.addedNodes)) {
          if (node.parentNode === source.head && isStyleNode(node) && !copies.has(node)) add(node);
        }
      } else {
        const owner = headChildOf(record.target);
        if (owner) changed.add(owner);
      }
    }
    for (const owner of changed) refresh(owner);
  });
  observer.observe(source.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  const adopted = copyAdoptedStyleSheets(source, target);

  return () => {
    observer.disconnect();
    for (const clone of copies.values()) (clone as ChildNode).remove();
    copies.clear();
    end.remove();
    if (adopted.length > 0) {
      target.adoptedStyleSheets = target.adoptedStyleSheets.filter(
        (sheet) => !adopted.includes(sheet),
      );
    }
  };
}

// Constructed sheets belong to one document, so they are rebuilt from their rules in
// the target document's realm.
function copyAdoptedStyleSheets(source: Document, target: Document): CSSStyleSheet[] {
  const view = target.defaultView as WindowWithCSSOM | null;
  const sheets = source.adoptedStyleSheets ?? [];
  if (!view || sheets.length === 0) return [];

  const copies = sheets.map((sheet) => {
    const clone = new view.CSSStyleSheet();
    clone.replaceSync(Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n'));
    return clone;
  });
  target.adoptedStyleSheets = [...copies, ...target.adoptedStyleSheets];
  return copies;
}

/**
 * Dev-only accessibility checks for `<Frame>`, after axe-core's `frame-title`,
 * `frame-title-unique` and `frame-focusable-content` rules. See docs/design.md →
 * `<Frame>`.
 */

const GENERIC_TITLES = new Set(['iframe', 'frame', 'untitled', 'title']);
const URL_LIKE = /^[a-z][a-z\d+.-]*:|^\/|\.html?$/i;

/** What's wrong with a frame's `title` and `tabIndex` for assistive technology. */
export function frameA11yProblems(title: string | undefined, tabIndex: unknown): string[] {
  const problems: string[] = [];
  const text = title?.trim() ?? '';
  if (text === '') {
    problems.push(
      'has no `title`. Screen readers announce an iframe by its title; describe its content, e.g. `title="Order summary"`.',
    );
  } else if (GENERIC_TITLES.has(text.toLowerCase()) || URL_LIKE.test(text)) {
    problems.push(
      `has a generic \`title\` ("${text}"). Screen readers announce an iframe by its title; describe its content instead.`,
    );
  }
  if (tabIndex !== undefined && tabIndex !== null && Number(tabIndex) < 0) {
    problems.push(
      'has a negative `tabIndex`, which keeps keyboard users out of the content rendered into it. Remove it unless nothing inside is focusable.',
    );
  }
  return problems;
}

const mountedTitles = new Map<string, number>();

/**
 * Registers a mounted frame's title. `duplicate` says whether another mounted frame
 * already has it; `release` must be called on unmount or title change.
 */
export function claimFrameTitle(title: string): { duplicate: boolean; release: () => void } {
  const key = title.trim().toLowerCase();
  const count = mountedTitles.get(key) ?? 0;
  mountedTitles.set(key, count + 1);
  let released = false;
  return {
    duplicate: count > 0,
    release: () => {
      if (released) return;
      released = true;
      // Still counted: this claim hasn't been released yet.
      const left = (mountedTitles.get(key) as number) - 1;
      if (left > 0) mountedTitles.set(key, left);
      else mountedTitles.delete(key);
    },
  };
}

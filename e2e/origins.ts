// Two dev servers on different ports are two different origins, which is all
// cross-origin tests need. See docs/design.md → Testing.
export const HOST_PORT = 5173;
export const CHILD_PORT = 5174;
export const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`;
export const CHILD_ORIGIN = `http://127.0.0.1:${CHILD_PORT}`;

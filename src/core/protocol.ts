/**
 * Wire protocol v1. See docs/design.md → Wire protocol.
 *
 * Every message is a plain object with a `rik` marker. Messages without it are
 * ignored, so the library coexists with any other `postMessage` traffic on the page.
 * Every field is validated on the way in; a malformed message is dropped (`null`).
 */
import type { SerializedError } from './errors';

/** The handshake envelope marker. Fixed forever; see docs/design.md → Versioning. */
export const RIK = 1;

/** Protocol versions this build understands, highest first is not required. */
export const SUPPORTED_VERSIONS: readonly number[] = [1];

interface Envelope {
  rik: typeof RIK;
}

export interface SynMessage extends Envelope {
  type: 'syn';
  /** Present only on the child's syn; the parent's prompt syn carries none. */
  instance?: string | undefined;
  versions: readonly number[];
}

export interface AckMessage extends Envelope {
  type: 'ack';
  session: string;
  instance: string;
  version: number;
}

export type WindowMessage = SynMessage | AckMessage;

export interface ReadyMessage extends Envelope {
  type: 'ready';
}

export interface SizeMessage extends Envelope {
  type: 'size';
  width: number;
  height: number;
  loop?: boolean | undefined;
}

/** Child → parent, with `syncTitle`: the child document's (trimmed) `document.title`. */
export interface TitleMessage extends Envelope {
  type: 'title';
  title: string;
}

export interface ByeMessage extends Envelope {
  type: 'bye';
}

export interface CallMessage extends Envelope {
  type: 'call';
  id: string;
  method: string;
  args: unknown[];
}

export interface ResultSuccessMessage extends Envelope {
  type: 'result';
  id: string;
  ok: true;
  value?: unknown;
}

export interface ResultErrorMessage extends Envelope {
  type: 'result';
  id: string;
  ok: false;
  error: SerializedError;
}

export type ResultMessage = ResultSuccessMessage | ResultErrorMessage;

export interface EventMessage extends Envelope {
  type: 'event';
  name: string;
  payload?: unknown;
}

export type PortMessage =
  | ReadyMessage
  | SizeMessage
  | TitleMessage
  | ByeMessage
  | CallMessage
  | ResultMessage
  | EventMessage;

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  return d['rik'] === RIK && typeof d['type'] === 'string' ? d : null;
}

function isVersionList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => Number.isInteger(v));
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Parses a `window.postMessage` payload. Returns `null` for anything not ours. */
export function parseWindowMessage(data: unknown): WindowMessage | null {
  const d = record(data);
  if (!d) return null;

  if (d['type'] === 'syn') {
    if (!isVersionList(d['versions'])) return null;
    if (d['instance'] !== undefined && typeof d['instance'] !== 'string') return null;
    return {
      rik: RIK,
      type: 'syn',
      instance: d['instance'] as string | undefined,
      versions: d['versions'],
    };
  }

  if (d['type'] === 'ack') {
    if (
      typeof d['session'] !== 'string' ||
      typeof d['instance'] !== 'string' ||
      typeof d['version'] !== 'number'
    ) {
      return null;
    }
    return {
      rik: RIK,
      type: 'ack',
      session: d['session'],
      instance: d['instance'],
      version: d['version'],
    };
  }

  return null;
}

/** Parses a message received over the private `MessagePort`. */
export function parsePortMessage(data: unknown): PortMessage | null {
  const d = record(data);
  if (!d) return null;

  if (d['type'] === 'ready') return { rik: RIK, type: 'ready' };
  if (d['type'] === 'bye') return { rik: RIK, type: 'bye' };

  if (d['type'] === 'size') {
    if (!isFiniteNonNegative(d['width']) || !isFiniteNonNegative(d['height'])) return null;
    if (d['loop'] !== undefined && typeof d['loop'] !== 'boolean') return null;
    return {
      rik: RIK,
      type: 'size',
      width: d['width'],
      height: d['height'],
      loop: d['loop'] as boolean | undefined,
    };
  }

  if (d['type'] === 'title') {
    return typeof d['title'] === 'string' ? { rik: RIK, type: 'title', title: d['title'] } : null;
  }

  if (d['type'] === 'call') {
    if (
      typeof d['id'] !== 'string' ||
      typeof d['method'] !== 'string' ||
      !Array.isArray(d['args'])
    ) {
      return null;
    }
    return { rik: RIK, type: 'call', id: d['id'], method: d['method'], args: d['args'] };
  }

  if (d['type'] === 'result') {
    if (typeof d['id'] !== 'string' || typeof d['ok'] !== 'boolean') return null;
    if (d['ok']) return { rik: RIK, type: 'result', id: d['id'], ok: true, value: d['value'] };
    const error = parseSerializedError(d['error']);
    if (!error) return null;
    return { rik: RIK, type: 'result', id: d['id'], ok: false, error };
  }

  if (d['type'] === 'event') {
    if (typeof d['name'] !== 'string') return null;
    return { rik: RIK, type: 'event', name: d['name'], payload: d['payload'] };
  }

  return null;
}

function parseSerializedError(value: unknown): SerializedError | null {
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;
  if (typeof d['name'] !== 'string' || typeof d['message'] !== 'string') return null;
  if (d['code'] !== undefined && typeof d['code'] !== 'string' && typeof d['code'] !== 'number') {
    return null;
  }
  if (d['stack'] !== undefined && typeof d['stack'] !== 'string') return null;
  const error: SerializedError = { name: d['name'], message: d['message'] };
  if (d['code'] !== undefined) error.code = d['code'] as string | number;
  if ('data' in d) error.data = d['data'];
  if (d['stack'] !== undefined) error.stack = d['stack'] as string;
  return error;
}

/** The highest version present in both lists, or `undefined` if there is none. */
export function highestCommonVersion(
  a: readonly number[],
  b: readonly number[],
): number | undefined {
  let best: number | undefined;
  for (const v of a) {
    if (b.includes(v) && (best === undefined || v > best)) best = v;
  }
  return best;
}

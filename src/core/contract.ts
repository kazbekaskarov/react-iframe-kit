/**
 * Compile-time contracts for RPC and events. Types only: nothing here exists at
 * runtime. See docs/design.md → RPC and events API.
 */

// biome-ignore lint/suspicious/noExplicitAny: the widest function type, for matching only
type AnyFunction = (...args: any[]) => any;

type ReservedMethodName = 'then' | 'toJSON';

/** Structured-cloneable values that are objects but must not be searched for functions. */
type Opaque =
  | Date
  | RegExp
  | Error
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | MessagePort
  | ImageBitmap
  | Map<unknown, unknown>
  | Set<unknown>;

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * `true` if `T` is, or contains (through plain objects, arrays and tuples), a function.
 * Distributes over unions, so `string | (() => void)` counts. The depth limit keeps a
 * recursive type from recursing forever; past it, the value is assumed to be fine.
 */
type HasFunction<T, Depth extends unknown[] = []> =
  IsAny<T> extends true
    ? false
    : Depth['length'] extends 8
      ? false
      : T extends AnyFunction
        ? true
        : T extends Opaque
          ? false
          : T extends readonly (infer U)[]
            ? HasFunction<U, [...Depth, unknown]>
            : T extends object
              ? { [K in keyof T]-?: HasFunction<T[K], [...Depth, unknown]> }[keyof T]
              : false;

type Clean<T> = [HasFunction<T>] extends [false] ? true : false;

type CheckMethods<M> = {
  [K in keyof M]: K extends ReservedMethodName
    ? `react-iframe-kit: "${K}" can't be a method name (\`remote\` hides it)`
    : M[K] extends (...args: infer A) => infer R
      ? Clean<A> extends false
        ? 'react-iframe-kit: method arguments must not contain functions (they cannot be cloned)'
        : Clean<Awaited<R>> extends false
          ? 'react-iframe-kit: method return values must not contain functions (they cannot be cloned)'
          : M[K]
      : 'react-iframe-kit: every entry of `methods` must be a function type';
};

type CheckEvents<E> = {
  [K in keyof E]: Clean<E[K]> extends false
    ? 'react-iframe-kit: event payloads must not contain functions (they cannot be cloned)'
    : E[K];
};

/** What `Side<>` accepts: a side's methods and the events it emits, both optional. */
export interface Contract {
  methods?: object;
  events?: object;
}

type Checked<T extends Contract> = {
  methods?: CheckMethods<T['methods']>;
  events?: CheckEvents<T['events']>;
};

/** The shape every `Side<>` produces. */
export interface SideShape {
  methods: object;
  events: object;
}

/**
 * Describes one side of a connection: the methods it exposes and the events it
 * emits. `then`/`toJSON` method names and function-typed arguments, return values
 * and event payloads are compile errors here, since they can't work at runtime.
 *
 * ```ts
 * type ParentSide = Side<{
 *   methods: { navigate(path: string): void };
 *   events: { closed: void };
 * }>;
 * ```
 */
export type Side<T extends Contract & Checked<T>> = {
  methods: T extends { methods: infer M extends object } ? M : Record<never, never>;
  events: T extends { events: infer E extends object } ? E : Record<never, never>;
};

/** The side used when no contract is given: any method, any event. */
export interface AnySide {
  // biome-ignore lint/suspicious/noExplicitAny: an untyped contract accepts anything
  methods: Record<string, (...args: any[]) => unknown>;
  events: Record<string, unknown>;
}

/** `remote` for the other side: every method returns a promise of its awaited result. */
export type Remote<S extends SideShape> = {
  readonly [K in keyof S['methods']]: S['methods'][K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

/** Local implementations: any subset of this side's methods, sync or async. */
export type LocalMethods<S extends SideShape> = {
  [K in keyof S['methods']]?: S['methods'][K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : never;
};

type EventName<S extends SideShape> = keyof S['events'] & string;

// biome-ignore lint/suspicious/noConfusingVoidType: `void` payloads are how contracts spell "no payload"
type PayloadArgs<P> = [P] extends [void] ? [] : unknown extends P ? [payload?: P] : [payload: P];

/** `emit` for this side's events; a `void` event takes no payload. */
export type Emit<S extends SideShape> = <K extends EventName<S>>(
  name: K,
  ...payload: PayloadArgs<S['events'][K]>
) => void;

/** Subscribes to one of the other side's events; returns the unsubscribe function. */
export type On<S extends SideShape> = <K extends EventName<S>>(
  name: K,
  handler: (payload: S['events'][K]) => void,
) => () => void;

export type EventHandler<S extends SideShape, K extends EventName<S>> = (
  payload: S['events'][K],
) => void;

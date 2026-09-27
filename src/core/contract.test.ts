// Type-level tests: `pnpm typecheck` checks them (each `@ts-expect-error` must really
// be an error); the Vitest run only confirms the file loads.
import { describe, expectTypeOf, it } from 'vitest';
import type { Emit, LocalMethods, On, Remote, Side } from './contract';
import { withOptions } from './remote';

interface User {
  name: string;
  tags: string[];
  joined: Date;
}

type ParentSide = Side<{
  methods: { navigate(path: string): void; getUser(): User; load(): Promise<number> };
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is how contracts spell "no payload"
  events: { themeChanged: 'light' | 'dark'; closed: void };
}>;

describe('Side', () => {
  it('keeps valid methods and events as declared', () => {
    expectTypeOf<ParentSide['methods']['getUser']>().toEqualTypeOf<() => User>();
    expectTypeOf<ParentSide['events']['closed']>().toEqualTypeOf<void>();
  });

  it('defaults a missing half to an empty record', () => {
    type OnlyEvents = Side<{ events: { tick: number } }>;
    expectTypeOf<keyof OnlyEvents['methods']>().toEqualTypeOf<never>();
  });

  it('rejects reserved method names and non-cloneable types', () => {
    // @ts-expect-error `then` is reserved
    type _Then = Side<{ methods: { then(): void } }>;
    // @ts-expect-error `toJSON` is reserved
    type _ToJson = Side<{ methods: { toJSON(): string } }>;
    // @ts-expect-error a callback argument can't be cloned
    type _FnArg = Side<{ methods: { subscribe(cb: () => void): void } }>;
    // @ts-expect-error a nested function in an argument can't be cloned
    type _NestedArg = Side<{ methods: { save(x: { onDone: () => void }): void } }>;
    // @ts-expect-error a returned function can't be cloned
    type _FnReturn = Side<{ methods: { make(): () => void } }>;
    // @ts-expect-error a function inside an awaited return can't be cloned
    type _AsyncFnReturn = Side<{ methods: { make(): Promise<{ run: () => void }> } }>;
    // @ts-expect-error a function payload can't be cloned
    type _FnPayload = Side<{ events: { ready: () => void } }>;
    // @ts-expect-error `methods` entries must be functions
    type _NotFn = Side<{ methods: { x: number } }>;
  });

  it('accepts cloneable built-ins and `any`', () => {
    type Ok = Side<{
      // biome-ignore lint/suspicious/noExplicitAny: `any` must not be rejected
      methods: { a(d: Date, b: Blob, m: Map<string, number>, x: any): ArrayBuffer };
      events: { list: Array<{ id: string }> };
    }>;
    expectTypeOf<Ok['events']['list']>().toEqualTypeOf<Array<{ id: string }>>();
  });
});

describe('Remote / LocalMethods / Emit / On', () => {
  it('wraps remote results in a promise of the awaited value', () => {
    expectTypeOf<Remote<ParentSide>['getUser']>().toEqualTypeOf<() => Promise<User>>();
    expectTypeOf<Remote<ParentSide>['load']>().toEqualTypeOf<() => Promise<number>>();
  });

  it('allows any subset of local methods, sync or async', () => {
    const methods: LocalMethods<ParentSide> = {
      getUser: async () => ({ name: 'a', tags: [], joined: new Date() }),
    };
    expectTypeOf(methods).not.toBeAny();
    // @ts-expect-error wrong argument type
    const _bad: LocalMethods<ParentSide> = { navigate: (_path: number) => {} };
  });

  it('emit takes no payload for void events and a typed one otherwise', () => {
    const emit = (() => {}) as Emit<ParentSide>;
    emit('closed');
    emit('themeChanged', 'dark');
    // @ts-expect-error missing payload
    emit('themeChanged');
    // @ts-expect-error wrong payload
    emit('themeChanged', 'blue');
    // @ts-expect-error unknown event
    emit('nope');
  });

  it('withOptions accepts a typed remote method and keeps its signature', () => {
    const remote = {} as Remote<ParentSide>;
    expectTypeOf(withOptions<Remote<ParentSide>['load']>).returns.toEqualTypeOf<
      () => Promise<number>
    >();
    expectTypeOf(remote.navigate).parameters.toEqualTypeOf<[path: string]>();
  });

  it('on types the handler payload', () => {
    const on = (() => () => {}) as On<ParentSide>;
    on('themeChanged', (theme) => expectTypeOf(theme).toEqualTypeOf<'light' | 'dark'>());
  });
});

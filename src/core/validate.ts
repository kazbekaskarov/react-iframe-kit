/**
 * Runtime validation of what crosses the boundary, with any Standard Schema library
 * (Zod, Valibot, ArkType, …). Wrappers around methods and event handlers, so the
 * protocol and the entries that don't use it are unchanged. See docs/design.md →
 * Validation.
 */
import { IframeKitError } from './errors';

/** The Standard Schema v1 interface (https://standardschema.dev), copied as its spec asks. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export declare namespace StandardSchemaV1 {
  type Result<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<Issue> };
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
  }
  type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['output'];
}

/** An issue as it travels in a `RIK_VALIDATION` error's `data`: plain, cloneable. */
export interface ValidationIssue {
  message: string;
  path?: string[] | undefined;
}

async function check<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  value: unknown,
  what: string,
): Promise<Output> {
  const result = await schema['~standard'].validate(value);
  if (!result.issues) return result.value;
  const issues: ValidationIssue[] = result.issues.map(({ message, path }) => ({
    message,
    path: path?.map((segment) => String(typeof segment === 'object' ? segment.key : segment)),
  }));
  throw Object.assign(
    new IframeKitError(
      'RIK_VALIDATION',
      `react-iframe-kit: invalid ${what}: ${issues.map((issue) => issue.message).join('; ')}`,
    ),
    { data: issues },
  );
}

/**
 * Validates a method's arguments (as a tuple) before calling it. Invalid arguments
 * reject the call with `RIK_VALIDATION`, which the caller receives as a `RemoteError`
 * whose `cause.data` lists the issues. The method gets the schema's output, so
 * transforms and defaults apply.
 *
 * ```ts
 * methods: { pay: validateArgs(z.tuple([z.number().positive()]), (amount) => charge(amount)) }
 * ```
 */
export function validateArgs<Args extends readonly unknown[], Result>(
  schema: StandardSchemaV1<unknown, Args>,
  method: (...args: Args) => Result,
): (...args: Args) => Promise<Awaited<Result>> {
  return (...args) =>
    check(schema, args, 'arguments').then((valid) => method(...valid)) as Promise<Awaited<Result>>;
}

/**
 * Validates an event's payload before the handler sees it. An invalid payload is not
 * delivered; the `RIK_VALIDATION` error goes to `reportError` (the console, and error
 * trackers that listen for it), like an error thrown by a handler.
 *
 * ```ts
 * on('orderCompleted', validatePayload(Order, (order) => track(order)))
 * ```
 */
export function validatePayload<Payload>(
  schema: StandardSchemaV1<unknown, Payload>,
  handler: (payload: Payload) => void,
): (payload: Payload) => void {
  return (payload) => {
    check(schema, payload, 'event payload')
      .then(handler)
      .catch((error: unknown) => {
        // `reportError` is standard but not universal (some test runners lack it).
        if (typeof reportError === 'function') reportError(error);
        else console.error(error);
      });
  };
}

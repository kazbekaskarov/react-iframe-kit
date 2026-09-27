/**
 * `true` in the build selected by the `development` export condition, `false` in the
 * default (production) build. Dev-only checks and warnings must be guarded by it so
 * they are removed from the production build. See docs/design.md → Package layout.
 */
declare const __DEV__: boolean;

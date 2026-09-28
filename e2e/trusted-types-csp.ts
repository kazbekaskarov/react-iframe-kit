// Trusted Types policies for e2e/trusted-types.spec.ts, by `?case=`.
const REQUIRE = "require-trusted-types-for 'script'";
export const TRUSTED_TYPES_CSP: Record<string, string> = {
  // Any policy name may be created.
  enforced: REQUIRE,
  // Only the library's policy name is allowed.
  allowlisted: `${REQUIRE}; trusted-types react-iframe-kit`,
  // No policy may be created at all.
  refused: `${REQUIRE}; trusted-types 'none'`,
  'custom-trusted': `${REQUIRE}; trusted-types host`,
  'custom-string': REQUIRE,
};

// e2e/dual.spec.ts: the library's policy name, without 'allow-duplicates', so a second
// library copy can't create the policy again and has to reuse the first one's.
export const DUAL_HOST_CSP = TRUSTED_TYPES_CSP['allowlisted'] as string;

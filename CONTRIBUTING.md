# Contributing to react-iframe-kit

Thanks for helping out! Issues and PRs get a first response within 72 hours.

## Before you start

- **Read [docs/design.md](docs/design.md).** It is the source of truth for the public
  API and the wire protocol. A PR that changes either must update the design doc in the
  same PR.
- For anything bigger than a bug fix, open an issue first so we can agree on the
  approach before you write code.
- Look for issues labeled `good first issue` if you're new to the codebase.

## Setup

Requirements: Node.js 24 (see `.nvmrc`) and pnpm via Corepack.

```sh
corepack enable
pnpm install
pnpm exec playwright install   # browsers for e2e tests
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build `dist/` (ESM, CJS, dev build, child IIFE, types) |
| `pnpm typecheck` | Type-check sources, configs and e2e |
| `pnpm lint` / `pnpm lint:fix` | Biome lint + format check / autofix |
| `pnpm test` | Unit tests (Vitest, happy-dom) |
| `pnpm test:coverage` | Unit tests with coverage (100% required on `src/core`) |
| `pnpm test:e2e` | Playwright tests in Chromium, Firefox and WebKit |
| `pnpm check:package` | publint + are-the-types-wrong on the built package |
| `pnpm size` | Bundle size budgets (run `pnpm build` first) |

## Code layout

- `src/core/` — framework-agnostic: protocol, handshake, RPC, events, size measurement.
  No React imports. Aim for 100% unit test coverage.
- `src/react/` — React adapters (hooks, `<Frame>`). Thin wrappers over core.
- `src/child/` — the `react-iframe-kit/child` entry (runs inside the iframe; no React)
  and `child/react`.
- `e2e/` — Playwright tests. `e2e/fixtures/` is served by two Vite servers on different
  ports, which gives real cross-origin iframes.

Dev-only warnings go behind `if (__DEV__)`, which is removed from the production
build.

## Pull requests

1. Add tests. Bugs in cross-browser iframe behaviour need a Playwright test.
2. Run `pnpm lint && pnpm typecheck && pnpm test` locally.
3. Add a changeset if the published package changes: `pnpm changeset`.
4. Keep the PR focused; unrelated refactors belong in a separate PR.

## Reporting security issues

Please don't open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

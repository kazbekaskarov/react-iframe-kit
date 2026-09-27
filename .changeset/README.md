# Changesets

Every PR that changes the published package adds a changeset: run `pnpm changeset`,
pick the bump type, and describe the change for users. The release workflow turns
pending changesets into a version bump, a CHANGELOG entry and an npm release.

Changes to the wire protocol also need an update to `docs/design.md` in the same PR.

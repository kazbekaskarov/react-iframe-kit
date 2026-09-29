# Security policy

react-iframe-kit sits on a security boundary between origins, so we take reports
seriously.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](../../security/advisories/new) ("Report a vulnerability"
on the Security tab). Don't open a public issue.

Include the affected version, a description of the issue, and ideally a minimal
reproduction. You can expect an acknowledgement within 72 hours and a fix or mitigation
plan within 14 days for confirmed issues.

## Supported versions

Until 1.0, only the latest published version receives security fixes. From 1.0, the
latest major receives them, and the previous major does too for six months after a new
major is released.

## Scope

In scope: anything that lets a page other than the configured peer send or receive
messages, call methods, or read data through this library, as well as bypasses of the
origin checks described in [docs/design.md](docs/design.md#security).

Out of scope: the documented risk of opaque-origin (`origin: 'null'`) connections, and
issues that require the host page to be compromised already.

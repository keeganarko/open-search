# Security policy

Voyager is experimental software. The current 0.1.0 installer is unsigned,
requires manual updates, and is not recommended as a primary browser for
sensitive accounts. A clean dependency scan does not establish browser safety.
See [security operations](docs/SECURITY-OPERATIONS.md) for implemented controls,
activation requirements and current limits.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** on this repository:
[submit a private report](https://github.com/keeganarko/voyager/security/advisories/new).
Private vulnerability reporting is enabled. Please keep exploit details and
credentials out of public issues while a fix is being prepared.

Include the version/commit, operating system, affected feature, impact, and a
minimal reproduction using synthetic data. Never include real passwords,
API keys, browser profiles, private page content, or signing keys.

There is currently no guaranteed security response or patch delivery SLA.
The source implements authenticated updates, an engine release monitor,
malicious-domain/download defenses and packaged integration tests. Public-release
readiness still requires real signing identities, a signed update rehearsal,
platform authentication validation and independent testing.

## Source and releases

Public source is part of the threat model. Security must not depend on keeping
implementation details secret. Contributions do not automatically update an
installed browser; release provenance and signing need to establish which
builds are official.

Keep release credentials in protected CI environments or an external signing
service. Never expose them to fork pull requests. If a credential is exposed,
revoke/rotate it first; deleting a file or rewriting Git history does not revoke
copies already obtained by others.

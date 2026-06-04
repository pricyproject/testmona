# Security Policy

Thanks for helping keep **TestMona** and its users safe. We take security issues
seriously and appreciate the time and effort of everyone who reports them.

## Supported Versions

Security fixes are applied to the latest released version. We recommend always
running the most recent release.

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| < 0.4   | :x:                |

## Reporting a Vulnerability

**Please report security issues by opening a [GitHub Issue](https://github.com/pricyproject/testmona/issues).**

When filing the report:

1. Click **New issue** and use the **Bug report** template.
2. Prefix the title with **`[SECURITY]`** so it can be triaged quickly.
3. Add the **`security`** label if it is available to you.

To protect users while a fix is being prepared, **please avoid posting a
working exploit, proof-of-concept payload, or step-by-step weaponized
instructions in the public issue.** A clear description of the problem and its
impact is enough for us to reproduce and fix it — we will follow up in the issue
if we need more detail.

### What to include

A good report helps us act fast. Where possible, please provide:

- **Type of issue** — e.g. XSS, SQL injection, authentication bypass, SSRF,
  privilege escalation, insecure default, dependency vulnerability.
- **Affected area** — the URL, API endpoint, component, or file involved
  (backend, frontend, Docker config, etc.).
- **Version / commit** — the TestMona version or commit SHA you tested against.
- **Environment** — how you are running it (Docker, local dev, deployment).
- **Reproduction steps** — the minimal steps needed to trigger the issue.
- **Impact** — what an attacker could achieve (read data, take over an account,
  run code, etc.).
- **Suggested fix** — if you have one (optional, but welcome).

## Our Response Process

When a report comes in, we aim to:

| Stage              | Target                                             |
| ------------------ | -------------------------------------------------- |
| Acknowledge report | within **3 business days**                         |
| Initial assessment | within **7 business days**                         |
| Fix & release      | as soon as practical, based on severity            |

We will keep the issue updated with progress and will credit you in the release
notes once a fix ships, unless you ask to remain anonymous.

## Scope

In scope:

- The TestMona backend API (FastAPI) and database layer.
- The TestMona frontend (React).
- The provided Docker / deployment configuration in this repository.

Out of scope:

- Vulnerabilities in third-party dependencies that are already publicly known
  and tracked upstream (please still let us know if we are shipping an affected
  version so we can bump it).
- Issues that require a compromised host, physical access, or an already
  privileged/administrator account.
- Findings from automated scanners without a demonstrated, real-world impact.
- Social engineering, spam, or denial-of-service via volumetric traffic.

## Safe Harbor

We consider security research conducted in good faith — and in line with this
policy — to be authorized. We will not pursue or support legal action against
researchers who:

- Make a genuine effort to avoid privacy violations, data destruction, and
  service disruption.
- Only interact with accounts and data they own or have explicit permission to
  test.
- Give us reasonable time to address an issue before disclosing it publicly.

## A Note on Self-Hosting

TestMona is self-hosted, so the security of any given deployment also depends on
how it is configured and operated. Please:

- Change all default credentials before exposing an instance.
- Set strong, unique secrets (`SECRET_KEY`, database passwords, AI provider
  keys) and never commit them.
- Keep your instance and its dependencies up to date.
- Serve it over HTTPS and restrict network access appropriately.

Thank you for helping make TestMona safer for everyone. 🛡️

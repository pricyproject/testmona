# Product Gaps

## High-Impact Gaps

- No clearly visible forgot-password or account recovery funnel from the login screen.
- No email verification funnel for new signups or invite acceptance.
- No SSO/SAML/OIDC login option for enterprise teams.
- No SCIM or automated user provisioning for larger organizations.
- No organization/workspace layer above projects, which limits multi-team and multi-company use.
- No billing, plan, quota, subscription, or entitlement model despite broad SaaS-style functionality.
- No clear role templates for common QA teams such as QA lead, tester, developer, product owner, release manager, auditor, and external stakeholder.
- No guided first project onboarding that teaches the user the best order: project, requirements, test cases, runs, defects, reports.
- No product sample project or tutorial workspace for first-time users.
- No checklist-driven setup completion score for admins.
- No clear release command center that combines requirements readiness, test execution, open defects, risk, approvals, and go/no-go decisions in one flow.
- No single traceability graph experience that visually connects docs, requirements, test cases, runs, defects, milestones, and releases.
- No true organization-level analytics across all projects, teams, and releases.
- No capacity planning view for testers, assignees, due dates, and run workload.
- No native execution calendar for planned test cycles, milestones, regression windows, and release gates.
- No robust automation runner or agent orchestration, despite CI ingestion and automation-related settings.
- No durable background job center for imports, exports, AI generation, webhook delivery, and long-running analytics.
- No advanced attachment management with cloud object storage, file retention rules, antivirus scanning, or file previews.
- No deep mobile-first execution mode for testers running test cases from phones or tablets.
- No offline-first execution mode for teams testing field devices, hardware, retail, or unstable environments.
- No native test evidence library for screenshots, videos, logs, console output, network traces, and attachments across runs.
- No explicit test data privacy controls for secrets, PII, and regulated data in test datasets.
- No test case ownership and review cadence system to keep old test assets fresh.
- No marketplace or plugin model for custom importers, exporters, AI providers, and issue trackers.
- No customer-facing release confidence score that can be shared with leadership.
- No built-in customer support or feedback capture inside the product.
- No public product status, incident banner, or maintenance notification system for hosted deployments.
- No accessible in-app product documentation or learning center beyond product pages and docs features.
- No differentiated landing dashboard by role; testers, managers, admins, and product owners need different home screens.
- No explicit cross-project dependency management for shared releases or platform programs.

## Module-Level Gaps

- Requirements support linking and review, but need stronger product discovery for requirement quality, ownership, lifecycle, and approval state.
- Test cases support AI assistance and rich fields, but need better evidence-driven maintenance, change impact prompts, and stale test review workflows.
- Test runs support execution, but need stronger partial-failure recovery, re-run logic, flaky test tracking, and blocked-test root cause paths.
- Defects support classic and richer management surfaces, but these should feel like one product rather than overlapping products.
- Doc Hub is strong, but the publishing, approval, and doc-to-test workflow should be clearer for non-technical users.
- Reports exist, but executives need simplified release health, quality trends, and business impact summaries.
- Advanced search is powerful, but users need examples, saved templates, natural language onboarding, and query health feedback.
- Work Inbox exists, but it should become a guided daily work queue with priority, SLA, due dates, and next-best actions.
- Webhooks exist, but event coverage is too small for modern integrations.
- AI Manager exists, but admins need cost forecasting, quality metrics, prompt versioning, and safety policies.

## End-User Perception Gaps

- A new user may not understand why test cases are tied so strongly to suite context.
- A manager may not know which module to visit first to prepare a release.
- A tester may not know the fastest path from assigned work to execution.
- A product owner may not see how requirement acceptance criteria convert into coverage and test evidence.
- An auditor may not trust audit logs if deletion or modification is possible.
- An admin may not know the difference between global settings, administrator settings, project settings, and test management settings.
- A stakeholder opening a shared report may need clearer explanation of pass rate, risk, blocked scope, and data freshness.

## Deep-Dive Accurate Gaps Found In The Current App

- Feature toggles are incomplete as product entitlements because many detail/edit routes bypass feature guards.
- Global Environments appears in navigation but redirects to Projects.
- Dashboard cards and quick actions need to respect disabled project features.
- Read-only users may see write actions in Requirements, Defects, DocHub, and some TestRuns states.
- Signup disabled state is not enforced at the direct `/signup` route.
- Frontend signup password rule does not match backend password policy.
- Profile fields use fake default personal data instead of empty values.
- Doc revision feature toggle exists but is not clearly enforced on revision routes.
- Defects are split between classic defect endpoints and richer defect-management endpoints.
- Webhooks support only three events despite a broad platform surface.
- Import job state and idempotency are in memory, limiting production confidence.
- Realtime notifications are best-effort and single-process.
- Rate limiting is process-local and not production-grade for multiple replicas.
- Arabic and Persian translation coverage is close but incomplete for active UI keys.
- AI source options are not fully consistent between AI Manager and assistant UI.

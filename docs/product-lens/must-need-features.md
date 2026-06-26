# Must-Need Features

## Enterprise Adoption

- Organization and workspace hierarchy above projects.
- SSO with OIDC and SAML.
- SCIM provisioning and deprovisioning.
- Email verification and password reset.
- Team and role templates.
- Permission preview for roles and project access.
- Immutable audit mode with retention policies.
- Legal hold and audit export bundles.
- API token scopes, expiry, rotation, and last-used metadata.
- Admin security dashboard for risky access, inactive users, and exposed public links.
- Data retention policies for projects, attachments, reports, docs, and audit logs.
- Object storage support for files and attachments.
- Antivirus or malware scanning pipeline for uploaded files.
- Backup and restore guidance for production deployments.

## Core QA Workflow

- Guided first-project setup wizard.
- Sample project option with realistic QA data.
- Role-based dashboard for tester, QA lead, product owner, admin, and executive stakeholder.
- Release readiness command center.
- Visual traceability graph across docs, requirements, tests, runs, defects, milestones, and releases.
- Requirement approval workflow with required reviewers and release blocking.
- Test case review workflow with ownership, stale review dates, and approval state.
- Test run recovery if result creation fails after run creation.
- Re-run and verification workflow for failed tests and resolved defects.
- Tester daily queue with assigned work, due dates, blocked items, and priority.
- Defect triage queue with duplicate detection, severity validation, ownership, and SLA.
- Environment matrix planning for browsers, devices, OS versions, and app versions.
- Test evidence capture and reuse across results, defects, and reports.
- Flaky test lifecycle management.
- Coverage gap recommendations.

## Reporting And Analytics

- Executive quality dashboard.
- Release go/no-go report.
- Cross-project quality trend analytics.
- Tester workload and throughput analytics.
- Escaped defect tracking.
- Defect aging and SLA analytics.
- Requirement volatility and change impact analytics.
- Test maintenance cost analytics.
- Automation versus manual coverage analytics.
- Shareable reports with expiry, access logs, and recipient-friendly summaries.
- Scheduled report delivery by email or Slack.

## Integrations And Automation

- Durable webhook delivery queue with retries and delivery logs.
- Broader webhook event catalog.
- CI/CD integration setup guides for GitHub Actions, GitLab CI, Jenkins, Azure DevOps, and CircleCI.
- Build history objects connected to test results.
- Automated test result ingestion with branch, commit, build, environment, and artifact metadata.
- Two-way issue tracker sync with conflict resolution.
- Slack and Microsoft Teams app integrations.
- Calendar integration for test cycles and milestones.
- Import job monitor with progress, errors, rollback, and resume.
- Export job monitor for large reports and project exports.

## Product Experience

- Unified empty state system with module-specific next actions.
- Consistent success, error, loading, retry, and offline states across modules.
- In-app learning center and contextual help.
- Query templates for advanced search.
- Keyboard shortcut guide.
- Strong mobile execution layout.
- Accessibility audit and WCAG compliance pass.
- Consistent translation coverage for all user-facing strings.
- More explicit RTL QA for tables, forms, charts, editors, and navigation.

## Must-Need Fixes Before Scaling Adoption

- Feature entitlement consistency across list, detail, edit, execute, revision, and report pages.
- Permission-aware CTAs and empty states across all modules.
- Real disabled-signup route behavior.
- Unified password policy in frontend and backend.
- Removal of fake profile data defaults.
- Persistent import/export job center.
- Durable webhook queue and event replay.
- Shared rate limiting and realtime notification infrastructure for multi-node deployments.
- Locale parity automation for English, Arabic, and Persian.
- One defect product model across UI, API, reports, and integrations.

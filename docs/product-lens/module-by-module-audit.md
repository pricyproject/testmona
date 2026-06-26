# Module-By-Module Product Audit

## Authentication And Setup

### What Exists

- Setup wizard for first admin creation.
- Login with email or username.
- Two-factor challenge during login.
- Signup page.
- Invite acceptance route.
- Profile password change, 2FA, avatar, account deletion, and profile editing.

### Deep Product Gaps

- No visible forgot-password entry point from login.
- Signup disabled state is checked on login but not on direct signup route.
- Frontend signup password minimum differs from backend strength policy.
- Registration success query is sent to login, but the login UX should explicitly confirm account creation.
- Account lifecycle lacks email verification, admin approval, lost 2FA recovery, and enterprise SSO.

### Best Next Improvements

- Add password reset and email verification.
- Add signup-disabled route handling.
- Align password policy everywhere.
- Add post-setup workspace readiness checklist.
- Add SSO/OIDC/SAML and SCIM for enterprise adoption.

## Projects And Navigation

### What Exists

- Project CRUD, archive/delete/clone, import/export, search/filter/sort, and bulk operations.
- Project selector controls app context.
- Project-scoped navigation is feature-aware.

### Deep Product Gaps

- Root goes to `/projects`, login success goes to `/dashboard`, and logo click goes to `/dashboard`.
- Dashboard may be reachable even when it is hidden from the sidebar state.
- Global Environments nav redirects away.
- Activity Management is visible only when no project is selected, but some dashboard fallbacks navigate there.

### Best Next Improvements

- Define one product home strategy by role.
- Make navigation deterministic across root, login, logo, and redirects.
- Remove or implement global environment management.
- Add a first-project activation funnel.

## Requirements

### What Exists

- Requirement CRUD, folders, filters, views, import/export, Gherkin support, comments/review, linking, versions, and AI assistance.

### Deep Product Gaps

- Requirement detail route is not feature-guarded.
- Write controls appear insufficiently permission-aware in the frontend.
- Requirement quality and approval are not central enough to the flow.
- Requirement changes should more strongly trigger test impact review.

### Best Next Improvements

- Add requirement quality score.
- Add approval gates and required reviewers.
- Add change-impact queue for affected tests and docs.
- Add product-owner review board.

## Doc Hub

### What Exists

- Global and project docs, spaces, folders, import/export, public links, pinned/recent docs, review, revisions, stats, feedback, related links, AI doc workflows, and release notes.

### Deep Product Gaps

- Doc detail/revision/edit routes bypass project `doc_hub` feature guard.
- `doc_revisions` exists as a feature but appears not clearly enforced.
- Public sharing needs stronger expiry, revocation, access logs, and sensitivity warnings.
- Doc publishing workflow is less clear than doc editing/review capabilities.

### Best Next Improvements

- Clarify Doc Hub lifecycle: draft, review, approved, published, archived.
- Enforce doc feature toggles on all doc surfaces.
- Add public link governance.
- Turn docs into a first-class source for quality graph and AI retrieval.

## Test Cases And Suites

### What Exists

- Suites, sections, test cases, multi-step cases, shared steps, custom fields, tags, data parameters, environments, AI assistant, revisions, execution history, import/export, and direct execution.

### Deep Product Gaps

- Test case detail/edit/revision/history/execute routes are not guarded by `test_cases`.
- Users may not understand why test case creation depends on suite or section context.
- AI generated tests need a clearer review and approval state before becoming trusted assets.
- Test maintenance should be more proactive and central.

### Best Next Improvements

- Add AI-generated asset labels and approval status.
- Add stale-test review queue.
- Add duplicate merge workflow.
- Add suite-independent quick test case creation if the product wants low-friction test design.

## Test Runs And Execution

### What Exists

- Test runs, run detail, execution pages, run report, matrix runs, assignments, environments, priority, test plans, milestones, results, step outcomes, timing, and defect links.

### Deep Product Gaps

- Test run detail/report/execution child routes are not consistently feature-guarded.
- Empty-state create CTA can appear to users without write permission.
- Test run creation risks partial state if run creation succeeds and result creation fails.
- Matrix runs are not prominent in main navigation.
- Assigned tester queue should be more central.

### Best Next Improvements

- Make run creation atomic or recoverable.
- Add tester execution cockpit.
- Add rerun workflow for failed and flaky tests.
- Add live run coordination and blocked-test owner flow.

## Defects

### What Exists

- Defect list/table/board, saved filters, bulk edit, detail route, root-cause analysis, external tracker settings, classic defect APIs, rich defect-management APIs, comments, attachments, history, templates, and issue tracker integrations.

### Deep Product Gaps

- Defect detail route bypasses the frontend feature guard.
- Classic defect API and rich defect-management API overlap.
- Defect write/admin controls are not consistently permission-aware in the frontend.
- Defect triage, duplicate resolution, verification, and prevention should be stronger product funnels.

### Best Next Improvements

- Unify the defect model and API/product naming.
- Add triage board with SLA, duplicate detection, severity guidance, and owner assignment.
- Add fix verification workflow connected to test reruns.
- Add defect prevention actions after root-cause analysis.

## Reports And Analytics

### What Exists

- Dashboard analytics, reports layout, overview, coverage/risk, activity, shared reports, run reports, root-cause analysis, and test asset health.

### Deep Product Gaps

- Reports error messages are not consistently translated.
- Executive/stakeholder reports need stronger decision framing.
- Release readiness metrics exist but are not yet a full release gate workflow.
- Cross-project executive analytics need a clearer home.

### Best Next Improvements

- Add release command center.
- Add go/no-go report with evidence.
- Add scheduled report delivery.
- Add cross-project quality trends and escaped defect analytics.

## Work Inbox And Notifications

### What Exists

- In-app notifications, SSE stream, preferences, work inbox, smart views, filtering, snooze/archive/done, summaries, actors/projects, bulk actions, and keyboard hints.

### Deep Product Gaps

- Inbox API failures can look like empty states because several failures are logged without user-visible error.
- Realtime is best-effort and single-process.
- Work inbox should become the role-based daily work queue, not just a triage center.

### Best Next Improvements

- Add clear inbox failure/error states.
- Add priority and due-date model.
- Add role-specific inbox views.
- Back realtime with a shared pub/sub layer.

## Settings, Admin, And Integrations

### What Exists

- Global settings, administrator mode, project settings, project features, users, AI manager, audit, integrations, custom fields, webhooks, API tokens, test management settings.

### Deep Product Gaps

- Settings IA is dense and overlapping.
- Webhook event coverage is too small.
- Webhook delivery is not backed by a durable queue.
- AI Manager needs cost, quality, safety, and governance UX.
- API tokens need enterprise scopes, expiration, rotation, and last-used visibility.

### Best Next Improvements

- Reframe settings into Personal, Project, Workspace, Security, Integrations, AI, and Compliance.
- Add durable webhooks and broader events.
- Add AI governance dashboard.
- Add organization/workspace-level controls.

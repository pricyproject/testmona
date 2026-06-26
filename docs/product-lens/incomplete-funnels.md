# Incomplete Funnels

## Account And Access Funnels

- **Signup funnel:** User can reach signup, but email verification, admin approval, onboarding, and post-signup success messaging need stronger completion.
- **Signup disabled funnel:** Login can hide signup, but direct signup route can still appear, creating a confusing dead path.
- **Forgot password funnel:** No clear end-user path from login to password reset.
- **Invite funnel:** Invite acceptance exists, but should show invite metadata, expiry handling, resend request, and post-accept onboarding.
- **First admin setup funnel:** Setup exists, but should continue into workspace setup, first project creation, AI provider setup, and sample data decisions.
- **2FA funnel:** Login challenge exists, but recovery code education, lost-device recovery, admin reset, and enforcement policies need clearer UX.
- **API token funnel:** Token management exists, but needs scopes, expiry presets, last-used data, rotation prompts, and integration examples.

## Project Onboarding Funnels

- **Create first project:** Should continue into choosing methodology, importing requirements, creating suites, adding members, and enabling integrations.
- **Project selection:** Auto-selection can bypass an intentional choose-project step.
- **Project feature setup:** Feature toggles exist, but users need presets such as Manual QA, Automation QA, Regulated Team, Startup, and Enterprise.
- **Member onboarding:** Project members exist, but role invitation should include recommended role, permissions preview, and first task assignment.
- **Environment setup:** Environment pages exist, but global and project-scoped environment navigation should be clarified.

## Requirements Funnels

- **Requirement creation to approval:** Requirements can be created and reviewed, but approval stages, required reviewers, and release eligibility need stronger funneling.
- **Requirement to test coverage:** Linking exists, but users need a guided path from uncovered requirement to generated or selected test cases.
- **External requirement import:** External import helpers exist, but mapping, deduplication, sync status, and conflict handling need stronger product flow.
- **BDD import:** Feature import/export exists, but users need validation, preview, mapping, and traceability confirmation.
- **Requirement change impact:** Versioning exists, but changed requirements should trigger suggested test updates and reviewer assignments.

## Test Design Funnels

- **Test suite creation to test case creation:** Users may need a suite before they can comfortably create test cases, but the product should explain this clearly.
- **AI generated case to approved case:** AI drafts exist, but the review, edit, approve, save, and link flow should be explicit.
- **Duplicate detection to resolution:** Duplicate detection exists, but users need merge, ignore, link, or archive workflows.
- **Shared step reuse:** Shared steps exist, but users need discovery while writing test cases and impact warnings when shared steps change.
- **Test data to execution:** Datasets and parameters exist, but the path from dataset definition to resolved execution values should be more guided.

## Test Execution Funnels

- **Create run to execute run:** Run creation exists, but selected cases, generated result records, assignee workload, and failure recovery need stronger guarantees.
- **Assigned tester queue:** A tester should land directly on assigned tests, due dates, blocked work, and next action.
- **Failed step to defect:** Defect creation from failures exists conceptually, but evidence, snapshots, owner assignment, severity suggestion, and external sync should be seamless.
- **Blocked test to unblock action:** Blocked tests should generate owner, reason, dependency, due date, and follow-up reminders.
- **Re-run funnel:** Failed or flaky tests need an explicit re-run, compare, and confirm-fixed workflow.
- **Execution evidence funnel:** Screenshots, logs, video, and attachments should be captured and reused in defects and reports.

## Defect Funnels

- **Create defect to triage:** Defects exist, but triage queue, severity validation, duplicates, owners, SLAs, and external sync need stronger flow.
- **Defect to root cause:** Root cause analysis exists, but should connect to requirements, code area, test gaps, and prevention tasks.
- **Defect to verification:** After fix, the product should guide users to re-test impacted cases and close evidence loops.
- **External tracker sync:** Integrations exist, but conflict resolution, inbound updates, and sync history need to be clear.

## Reporting Funnels

- **Report generation to stakeholder decision:** Reports exist, but recipients need executive summary, data freshness, scope, risks, and go/no-go status.
- **Shared report funnel:** Public sharing exists, but expiry, revocation, access analytics, and stakeholder-friendly explanations are needed.
- **Release readiness funnel:** Dashboard readiness metrics exist, but a full release gate workflow with approvals is missing.
- **Audit export funnel:** Audit exists, but compliance users need immutable exports, date ranges, evidence bundles, and retention rules.

## Integration Funnels

- **Webhook setup:** Webhooks exist, but event selection is narrow and delivery monitoring needs to be more user-visible.
- **CI ingestion:** JUnit and CTRF ingestion exist, but pipeline setup, build history, failure trends, and automation ownership need a full funnel.
- **Issue tracker integration:** Setup exists, but users need test connection, field mapping, sync direction, conflict rules, and monitoring.
- **AI provider setup:** AI Manager exists, but admins need model recommendations, budget limits, task routing presets, quality checks, and data safety controls.

## Newly Confirmed Incomplete Funnels

- **Disabled feature funnel:** Admin disables a feature, sidebar hides it, but user can still open some deep links. Completion should be full access denial with explanation.
- **Read-only action funnel:** Viewer sees a write CTA, clicks it, and is blocked later. Completion should be permission-aware CTA hiding or request-access UX.
- **Signup disabled funnel:** Signup link can be hidden, but direct signup route still renders. Completion should show registration disabled state before form submission.
- **Password policy funnel:** User satisfies frontend password rule but fails backend rule. Completion should use one shared policy and live guidance.
- **Webhook reliability funnel:** User creates webhook and sees delivery records, but retries are not durable across restarts. Completion should include queue-backed delivery, replay, and dead-letter handling.
- **Import job funnel:** User starts import, but job state is memory-backed. Completion should include persistent progress, retry, cancel, and resume.
- **Profile onboarding funnel:** User opens profile and sees fake defaults. Completion should use empty profile fields, placeholders, and a real profile completion guide.
- **Doc revision control funnel:** Admin toggles doc revisions but route behavior does not clearly change. Completion should clarify whether revisions are part of Doc Hub or separately controllable.

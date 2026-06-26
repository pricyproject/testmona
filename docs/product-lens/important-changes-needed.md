# Important Changes Needed

## Priority 0: Fix Confusing Or Trust-Damaging Flows

- Add a visible forgot-password flow.
- Align all post-auth redirects around one intentional home strategy.
- Block or redirect direct signup when signup is disabled.
- Show clear registration, setup, and invite success states.
- Fix global environments navigation so it does not behave like a dead link.
- Guard detail, edit, execute, and revision routes consistently when project features are disabled.
- Clarify the difference between settings, administrator, project settings, and test management settings.
- Remove or clearly mark placeholder profile defaults so they cannot look like real user data.
- Unify classic defects and rich defect management into one user-facing model.
- Make test run creation atomic from the user's perspective or provide recovery when result creation fails.
- Align frontend signup password validation with backend policy.
- Remove fake profile defaults immediately.
- Enforce feature toggles on deep links, edit pages, execute pages, report pages, and revision pages.
- Make all write CTAs permission-aware.
- Decide whether `doc_revisions` is a real feature toggle or part of `doc_hub`.

## Priority 1: Strengthen Core End-User Journeys

- Add guided onboarding from first project to first requirement to first test run.
- Add role-based dashboards and daily queues.
- Add release readiness command center.
- Add guided requirement-to-test coverage workflow.
- Add AI generated test review and approval workflow.
- Add defect triage and verification workflow.
- Add stronger report sharing context, expiry, and access logs.
- Add import and export job progress pages.
- Add webhook delivery logs and retry controls.
- Add consistent empty states across all modules.

## Priority 2: Enterprise Readiness

- Add organization/workspace structure.
- Add SSO and SCIM.
- Add immutable audit and retention policies.
- Add object storage abstraction.
- Add durable background job queue.
- Add distributed rate limiting and realtime architecture for multi-node deployments.
- Add public API versioning and deprecation policy.
- Add compliance controls for public links, exports, attachments, AI, and audit logs.
- Add admin health dashboard for jobs, sync, webhooks, storage, and AI providers.
- Replace in-memory import job/idempotency/lock state with persistent job state.
- Replace daemon-thread webhook retry with a durable queue.
- Replace process-local realtime and rate limiting for production deployments.
- Expand webhook event catalog across all major product domains.

## Priority 3: AI And Differentiation

- Add semantic retrieval for AI across project assets.
- Add citations and confidence for AI answers.
- Add AI quality scoring for requirements and test cases.
- Add risk-based run recommendations.
- Add release go/no-go AI summary.
- Add AI-generated evidence packets.
- Add AI evaluation and feedback loop.
- Add cost and budget controls per project and provider.

## Priority 4: Polish And Scalability

- Complete translation coverage and avoid hardcoded UI strings.
- Verify RTL behavior across complex tables, charts, editors, and drawers.
- Standardize loading, error, success, retry, and offline UX.
- Improve mobile execution experience.
- Improve advanced search discoverability with templates and examples.
- Add keyboard shortcut guide and command palette.
- Add accessibility testing and remediation.
- Add stronger documentation inside the product.

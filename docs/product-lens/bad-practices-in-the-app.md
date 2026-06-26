# Bad Practices In The App

This file lists product and implementation practices that can harm end-user trust, adoption, or operational readiness.

## User Experience Practices

- Inconsistent landing destinations after login, root navigation, brand click, and authenticated redirects.
- Navigation items that appear available but redirect elsewhere or depend on hidden state.
- Important features exposed through routes but not made discoverable in the main navigation.
- Similar setting areas with unclear names and overlapping purposes.
- Creating a mental dependency between test cases and suites without enough explanation for new users.
- Relying on advanced search syntax without strong examples, templates, and guided query creation.
- Showing default profile values that can be mistaken for real user data.
- Not consistently surfacing success states after signup, setup, invite acceptance, imports, exports, and sharing actions.
- Uneven empty states across modules.
- Uneven loading, retry, offline, and partial-failure states across modules.
- User-facing strings that are not fully translated despite multi-language support.
- AI actions that may not clearly explain source context, confidence, limitations, and required review.

## Product Architecture Practices

- Overlapping defect APIs and surfaces that may create duplicate concepts.
- Feature flags that hide collection routes but may not guard every detail, edit, and revision route.
- In-memory job state for imports or locks where users expect durable processing.
- In-process webhook delivery where users expect guaranteed integration delivery.
- In-process rate limiting and realtime state where users may deploy multiple replicas.
- Local file storage without a clear production storage abstraction.
- Audit logs that can be deleted or changed without a separate compliance retention model.
- Broad API surface without clear public API versioning and deprecation policy.
- Long-running AI and import actions handled synchronously instead of through user-visible jobs.
- Best-effort side effects that may fail silently from the user's perspective.

## Security And Compliance Practices

- Missing visible password reset flow.
- Missing email verification for signup and account lifecycle.
- Missing enterprise SSO and provisioning.
- Audit purge capability without clear legal hold, retention policy, or immutable export.
- Public links that need stronger expiry, revocation, access logs, and sensitivity controls.
- Attachment handling without visible malware scanning, content validation, or retention policies.
- AI provider configuration without clearly visible data residency, retention, redaction, and prompt logging policies.
- API tokens that need strong UX around scope, expiry, rotation, last used, and least privilege.

## Collaboration Practices

- Comments, mentions, review requests, watchers, notifications, and inbox appear powerful but need one unified collaboration model.
- Assigned work should appear as a first-class daily queue rather than only as notifications or filters.
- Reviews should have clearer required approvers, due dates, reminders, and escalation.
- Stakeholder sharing should explain what the recipient can see and what data is hidden.
- External issue sync should clearly show sync status, last sync time, conflicts, and ownership.

## AI Practices

- AI output should always show what project context was used.
- AI output should show confidence, assumptions, and missing context.
- AI test generation should require explicit human approval before becoming source-of-truth content.
- AI-generated requirements and tests should be marked and trackable until reviewed.
- AI features should include evaluation metrics and admin visibility into cost, latency, errors, and quality.
- AI prompt changes should be versioned for reproducibility.
- AI should not be only generative; it should also monitor, predict, prioritize, and explain risk.

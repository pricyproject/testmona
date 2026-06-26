# UX, Permissions, And i18n Audit

## UX Issues To Fix First

- Make route destinations consistent: root, login success, authenticated login redirect, and logo click should not send users to different conceptual homes.
- Remove visible navigation that redirects away, especially global `/environments`.
- Make dashboard quick actions feature-aware so disabled modules do not still appear as actionable cards.
- Add success feedback for registration, setup completion, invite acceptance, import completion, export completion, sharing, and webhook tests.
- Replace fake profile defaults with empty values and placeholders.
- Add clear error states where pages currently degrade into empty selectors or empty lists.
- Add role-specific empty states. A viewer should see “request access,” not “create.”
- Add confirmation context for destructive bulk operations: exact count, affected entity types, and undo/rollback availability if possible.
- Make matrix runs, root-cause analysis, and test asset health more discoverable from the main execution/reporting flows.

## Permission UX Issues

- Viewer/read-only users can see some create/edit/bulk controls in Requirements, Defects, DocHub, and TestRuns empty states.
- Backend RBAC blocks many writes, but frontend affordances should prevent predictable 403 experiences.
- Integrations and project-level settings need clearer admin-only affordances.
- Disabled feature modules should hide or block all child pages, not only list pages.
- CTAs should communicate permission requirements and provide a request-access path.

## i18n Issues

- Add CI key-parity checks for `en`, `ar`, and `fa` translation files.
- Replace hardcoded English strings in ProjectGuard, TestRuns, Profile, Reports, and module-specific errors.
- Avoid passing English literals into translation placeholders.
- Add translation coverage for Test Asset Health keys missing from Arabic and Persian.
- Add reviewer workflow for new UI strings so every new component includes English, Arabic, and Persian keys.

## RTL Issues

- Replace fixed `mr-*`, `ml-*`, `space-x-*`, and left/right classes with logical spacing or RTL-aware variants.
- Audit Profile, ReportsLayout, Defects, DocHub, and complex tables because these areas show fixed-direction icon spacing.
- Verify charts, drawers, modals, tables, breadcrumbs, and rich editors in RTL.
- Add RTL visual regression screenshots for critical workflows.

## Loading And Error State Issues

- Work Inbox should distinguish between true empty state and failed load.
- TestRuns should tell users when reference data like test cases, suites, users, sections, or environments failed to load.
- Defect form should not silently show empty linked test cases, requirements, or members after reference-load failure.
- Reports should use translated, action-oriented errors with retry.
- AI actions should show source context, generation status, failure cause, and whether any partial output was saved.

## Accessibility Issues To Audit

- Keyboard-only execution for test runs.
- Screen reader labels for status badges, charts, progress bars, and icon-only buttons.
- Focus management in modals, drawers, command flows, and AI generation panels.
- Color contrast on status chips in light/dark modes.
- Table navigation and row action discoverability.
- Error summary at top of long forms.
- Accessible explanation of AI confidence and source citations.

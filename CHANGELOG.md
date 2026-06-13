# Changelog

All notable changes to **TestMona** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.5] - 2026-06-13

### Added
- **Environment matrix runs.** Group N per-environment test runs under a single matrix
  and review them in a pivot results view (RTL-localized).
- **Auto-defects.** Automatically create defects when test results fail, and keep defect
  status in sync with external issue trackers.
- **Test asset health scoring.** A health-score engine for test assets, with bulk resolve
  of flagged debt items.
- Milestones auto-update their progress and status from test execution; notify the
  milestone owner when a run completes, and notify a defect's assignee when assigned.
- Dashboard **release readiness** card.
- Test cases: an advanced query language with a `/` command palette and a responsive UI.
- Structured JSON logging pipeline (structlog) and tenacity-based retry/backoff for
  tracker calls and `project_seq` allocation.
- PostgreSQL support via psycopg2 on Python 3.13, with the runtime baseline aligned to 3.13.

### Changed
- Frontend modernization: adopt **React Query** for data fetching and **React Hook Form**
  for forms across the forms and list pages, and replace axios instance monkey-patching
  with module-level state.
- Dashboard: modern cards and a responsive layout (behavior preserved).
- Auth: fold the password-change dependency onto `get_current_user` (fixes the API-token
  skip path).

### Fixed
- Concurrency: lock the project row during `project_seq` allocation to prevent colliding
  numbers; single-source defect numbering through the `project_seq` listener (with retry)
  and lock the milestone recompute; gate token cleanup behind a DB lease so only one
  replica runs it.
- Routes: move static routes ahead of dynamic path segments to prevent shadowing.
- Health: add a real DB/migration check to `/health`, and preserve the deep-link
  destination across the login redirect.
- TQL: make `!=` NULL-safe and extend `IS EMPTY` to cover empty strings.
- i18n: replace an unanalyzable dynamic import with explicit per-locale lazy imports.
- Startup: remove a duplicate migration call from the lifespan handler.
- Traceability: paginate the matrix query before hydration; repair matrix-run schema drift.
- Test plans: stop an infinite render loop caused by an unstable query fallback.
- Frontend: preserve transparent logo backgrounds.
- Build: bump tailwindcss to 4.3.1 to silence DEP0205 on Node 26.

### Security
- Auth: reject inactive users at login, revoke the old refresh token on rotation, and stop
  persisting raw refresh tokens; drop the forced-password-change redirect to a
  non-existent route.
- Config: require `SECRET_KEY` in production to prevent per-replica key drift.

## [0.5.4] - 2026-06-11

### Added
- **Test asset health monitoring** — surface flaky, stale, and unowned test assets, with
  server-side pagination for the debt-items table.
- **Test infrastructure** — backend pytest suite and frontend Vitest unit/integration
  tests, wired into CI.
- Typed response models for delete endpoints and remaining ad-hoc returns.
- i18n: lazy-loaded `fa` and `ar` locale chunks.
- Doc Hub: space stats, a reorder endpoint, per-space icons/colors, and a richer UI.

### Changed
- Replace `print()` with structured logging across the backend.
- Consolidate schema management onto a single Alembic authority.
- Replace deprecated `datetime.utcnow()` and FastAPI `on_event` with modern equivalents.

### Fixed
- Performance: eliminate N+1 query patterns in test-case RBAC and dashboard statistics.
- Remove hardcoded fallback data returned on DB errors.
- Import/export: restore route decorators and the `export_test_results` handler lost in a
  module split.
- i18n: pass the user's language to all `toLocaleDateString` calls; add 213 missing `fa`
  and 186 missing `ar` keys.
- TestRunDetail: fix RTL `space-x`/icon margins, i18n, type safety, silent errors, and a
  duplicate interface.
- Types: add `retest_needed`, `defect_links`, and `test_case.test_type` to `TestResult`.
- Test cases: add `projectId` to the `loadEnums` effect dependency array.
- Use `/health` (not `/api/health`) for the backend connectivity check.
- Remove a debug `console.log` from the `PasswordChangeDialog` render path.

## [0.5.3] - 2026-06-10

### Added
- **Two-factor authentication.** A secure TOTP-based 2FA flow with setup, enable/disable,
  and recovery codes, plus an admin reset.
- Redesigned **Report Defect** modal.
- Language selector on the first-run setup page.
- React Query provider and a top-level error boundary on the frontend.

### Changed
- Large backend/frontend modularization: schemas and models, CRUD, and import/export
  split into focused modules; test-management route registrars and the frontend API/page
  facades split apart; shared analytics helpers moved into the services layer.

### Fixed
- AI: surface the configured provider on failed calls and auto-activate the only usable
  provider; prevent reasoning-model truncation and malformed JSON from failing calls;
  clarify provider token limits.
- Execution: scope prev/next navigation to the run once its id resolves, and reset the
  form when paging to the next case after *Save & Next*.
- Docs: normalize converted requirements; tighten conversion and defect schemas.
- Migrations: align model metadata with migration-created indexes.
- Build: stop `.gitignore` from swallowing `app/**/test_*.py` source modules, and bind
  Pydantic forward refs under `TYPE_CHECKING` to satisfy ruff.

### Security
- **Viewer role is now genuinely read-only.** A central guard at the auth choke point
  blocks all non-self-service writes for the viewer role (account, own notifications, and
  personal saved views remain allowed); the UI hides write controls to match.
- Enforce project-scoped access and consolidate project permission checks.
- Use HttpOnly cookies for browser sessions; redact invitation tokens; sanitize diff HTML.

## [0.5.2] - 2026-06-07

### Added
- Environment **snapshot** for test runs, capturing the environment at run time.
- Enter-key support for saving in modal dialogs.

### Fixed
- Defect ID generation and validation.
- Requirements toolbar: prevent the view toggle from wrapping to the far right.
- Execution: prevent `NaN` from being passed to the execution-history API.
- Versioning: add the missing `color` parameter when creating a version tag.
- Revision history: display the correct user.
- Definitions: swallow the concurrent-seed race (MariaDB error 1020) in the default seeder.

## [0.5.1] - 2026-06-07

### Added
- **Per-project sequential IDs (`project_seq`).** Stable, per-project numbering for
  entities, with a resolver, helpers, and types; project-first URLs and badges across the
  app; and `project_seq` exposed in cross-reference and doc APIs.
- Dedicated `/administrator` settings area and per-project test management, with an
  *Administrator* entry in the profile dropdown for admins.
- Per-project test types, priorities, and step templates.
- Composite and partial database indexes.

### Fixed
- Advanced search: the TQL `id` field now refers to the per-project number, not the
  global id.
- Database: MySQL dialect-scoped compiler hook for `NULLS LAST/FIRST` ordering.

## [0.5.0] - 2026-06-06

### Added
- **MariaDB / MySQL support** with automatic database provisioning, an optional Compose
  service, env templates, and the PyMySQL driver.
- **Web-based first-run setup** with a secure setup flow and an admin-configurable
  default language.
- **Project feature toggles** — per-project enable/disable of modules, enforced across the
  API and surfaced in project settings.
- **Doc Hub** maturation: granular sharing (user/role/project grants with audit trail),
  AI-assisted conversion and enhancement, living release notes, change-impact analysis
  (with tf-idf ranking and an optional AI risk assessment), a reader feedback loop,
  favorites/pins, and recently-viewed docs.
- **Advanced Search & TQL** overhaul: AST + parser compiled through a per-entity field
  registry, actionable parse errors, deterministic value suggestions, and feature-gated
  export/values endpoints.
- **Project AI assistant** for requirements (backend + frontend), with action-specific
  test-case assistant workflows and AI similarity / duplicate detection for test-case
  generation.
- **AI provider manager** backend and model-routing settings.
- Requirements: folders and assistant metadata, redesigned portfolio views, review
  comments and history, tracker import, and bulk views.
- Test runs: environment selection and validation, assignee/executor and execution
  progress tracking, milestone linking, and clickable/editable linked defects.
- Test plans: derived rollups and plan-link management.
- Defects: link defects to requirements and test cases; first-class test-result
  defect links.
- Reports/analytics: consolidated analytics workspace, public shared-report viewer, and
  improved printable run reports.
- Test data: data-driven test support.
- Gherkin `.feature` import/export for requirements; `blocker_reason` as a first-class,
  reportable field; `skipped` status and a `blocked`/`failed` split.
- Compact density mode, redesigned notifications dropdown (RTL-aware), and sidebar groups.
- Elastic License 2.0 (ELv2).

### Changed
- Unified the not-executed result status to `not_started`.
- Merged global parameters into the project view and consolidated the analytics workspace
  (removed the standalone traceability page).

### Fixed
- Numerous test-run chart/report, requirement-editing, notification, and RTL-layout fixes.
- Import/export: align test-case endpoint URLs with backend routes and prevent dry-runs
  from breaking real imports.

### Security
- Resolved a large batch of code-scanning alerts (HTML/URL sanitization, path-expression
  handling, exception exposure) and bumped vulnerable dependencies (cryptography,
  urllib3, python-jose, python-multipart, requests).
- Added a vulnerability reporting policy and enforced defect project-ownership checks.

## [0.4.4] - 2026-06-04

### Added
- **Doc Hub — Change Impact Analysis.** Before publishing a document change, see
  the requirements, test cases, and defects it impacts, derived from converter
  provenance, lexical similarity, and end-to-end traceability links. An optional
  AI risk assessment summarizes the risk and recommends *publish / review / hold*.
  Available from the doc detail header and the editor toolbar (shown only when a
  doc has linked requirements).
- Requirement linking for documents.
- Editable components in DefectDetail.
- DocRequirementLinksSection component for document detail pages.

### Changed
- The AI risk assessment is skipped — and no AI request is sent — when the editor
  re-analyzes a draft that has not actually changed.
- Linked defects in test runs are now clickable, copyable, and status-editable.

### Fixed
- React 18 StrictMode handling in ReleaseNotes.

## [0.4.3] - 2026-06-03

### Added
- **Doc Hub (Docs-as-Code):** versioned spaces and documents, a rich document
  editor, document detail and revision history, conversion-preview dialog,
  related documents, public document sharing, and `@mention` support.
- **Advanced Search & TQL:** a dedicated search workspace backed by a query
  language for filtering across defects, requirements, and test cases.
- Doc Hub and advanced-search API clients, navigation wiring, and i18n.

### Fixed
- Aligned test-case import/export endpoint URLs with the backend routes.
- Prevented an import dry-run from interfering with real test-case imports.

## [0.4.2] - 2026-06-01

### Added
- Link defects directly to requirements.
- Test plan rollups and plan-link management.
- Hardened report sharing and export flows.

### Fixed
- Surfaced scoped analytics context and corrected chart/report output.
- Stabilized notification dropdown pagination and settings.
- Routed test-run cards to their detail page; corrected dialog state labels.
- Ensured authenticated API clients are used across the frontend.

### Security
- Fixed a DOM-text-reinterpreted-as-HTML code-scanning finding.

## [0.4.1] - 2026-05-30

### Added
- Action-specific AI test-case assistant workflows.
- Requirements: external tracker import, bulk views, and review comments UI.

### Fixed
- Rendered fenced Gherkin steps cleanly and improved Gherkin authoring.
- Recorded revisions for test-case step changes and exposed current-version metadata.
- Removed duplicate route registrations and shadowed schemas; sanitized issue titles.
- Honored CORS configuration, scoped schedules, and preserved tracker headers.
- Repaired data generation and Linear integration handling.

## [0.4.0] - 2026-05-28

### Added
- **AI Provider Manager** backend — pluggable, multi-provider AI configuration.
- Data-driven testing (test data) backend support.
- AI data and user-invitation workflows in the frontend.

### Fixed
- Aligned AI Manager settings buttons and surfaced expired-invitation badges.

## [0.3.4] - 2026-05-26

### Added
- Separated archived projects from the main project list.
- Project quality CI workflows.

### Fixed
- Respected soft-deleted test cases throughout the backend.
- Improved test-case revision history handling and suite display.

### Security
- Addressed code-scanning findings: incomplete multi-character sanitization,
  information exposure through exceptions, and DOM-based HTML reinterpretation.

## [0.3.2] - 2026-05-23

### Added
- Unified content editor across the app.
- Analytics workspace overhaul with expanded backend data.
- Public, shareable report viewer.
- Project clone and selective import flows.
- Defect linking from test executions (test-result ↔ defect links).

### Fixed
- Scoped audit activity and dashboard data; hardened requirement editing.

## [0.3.0] - 2026-05-18

### Added
- Test-run assignees and execution-progress flows.
- Compact density mode with live preview.
- Redesigned, RTL-aware notification dropdown.
- Improved test-case tags and shared steps; enhanced import workflow.

### Changed
- Split routes and vendor chunks for faster frontend loads.
- Extracted shared backend service helpers and a sortable test-case row component.
- Removed the syntax-highlighter dependency from Markdown rendering.

### Fixed
- Unified auth and integration API clients.

## [0.2.5] - 2026-05-12

### Added
- Bulk test execution with test-run creation.
- Dynamic priority options and refreshed test-suite management.
- Expanded internationalization coverage.

### Fixed
- Resolved timer counting and elapsed-time calculation issues.
- Added all selected test cases to a run; validated run project scope.
- Restored the unsaved-changes dialog for the Create New Project modal.

## [0.2.0] - 2026-05-10

### Changed
- Reworked the test-run UI.

## [0.1.0] - 2026-05-09

### Added
- Initial release of TestMona: projects, requirements, test cases, suites, runs,
  defects, milestones, and reports.

[Unreleased]: https://github.com/pricyproject/testmona/compare/v0.5.5...HEAD
[0.5.5]: https://github.com/pricyproject/testmona/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/pricyproject/testmona/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/pricyproject/testmona/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/pricyproject/testmona/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/pricyproject/testmona/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/pricyproject/testmona/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/pricyproject/testmona/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/pricyproject/testmona/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/pricyproject/testmona/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/pricyproject/testmona/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/pricyproject/testmona/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/pricyproject/testmona/compare/v0.3.2...v0.3.4
[0.3.2]: https://github.com/pricyproject/testmona/compare/v0.3.0...v0.3.2
[0.3.0]: https://github.com/pricyproject/testmona/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/pricyproject/testmona/compare/v0.2.0...v0.2.5
[0.2.0]: https://github.com/pricyproject/testmona/compare/0.1.0...v0.2.0
[0.1.0]: https://github.com/pricyproject/testmona/releases/tag/0.1.0

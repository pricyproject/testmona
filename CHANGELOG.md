# Changelog

All notable changes to **TestMona** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Doc Hub — Change Impact Analysis.** Before publishing a document change, see
  the requirements, test cases, and defects it impacts, derived from converter
  provenance, lexical similarity, and end-to-end traceability links. An optional
  AI risk assessment summarizes the risk and recommends *publish / review / hold*.
  Available from the doc detail header and the editor toolbar (shown only when a
  doc has linked requirements).

### Changed
- The AI risk assessment is skipped — and no AI request is sent — when the editor
  re-analyzes a draft that has not actually changed.

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

[Unreleased]: https://github.com/pricyproject/testmona/compare/v0.4.3...HEAD
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

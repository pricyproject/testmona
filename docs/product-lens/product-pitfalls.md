# Product Pitfalls

## Product Complexity Pitfalls

- The product has a very wide feature surface, which can overwhelm first-time users without guided onboarding.
- Similar capabilities are distributed across project settings, global settings, administrator settings, and module-specific settings.
- Defect tracking appears in both classic defects and richer defect-management APIs, creating risk of duplicated mental models.
- Users may struggle to understand when to use Doc Hub versus requirements versus test plans.
- Matrix runs are implemented but not prominent enough in primary navigation.
- Test asset health is valuable but may feel isolated unless connected to dashboards, runs, and release readiness.
- Advanced TQL search is powerful but intimidating without templates and query education.
- AI features are spread across several areas and may feel like tools rather than one coherent AI teammate.
- Feature toggles can hide modules, but deep links may still expose some detail pages, creating trust issues.
- The dashboard mixes project-level and global concepts depending on selected project state, which can confuse users.

## Funnel Pitfalls

- Login sends users to the dashboard, while root and authenticated login redirects may send users to projects.
- Signup can be hidden from login if disabled, but a direct signup route can still render the form.
- Registration appears to redirect with a success query parameter, but the login page does not clearly surface that success state.
- Project selection may auto-select a project, which can make navigation feel surprising.
- A global environments navigation item can route users away rather than showing an environment page when no project is selected.
- Test case creation can feel blocked if the user has not created or selected a suite.
- Test run creation creates the run and then result records separately, which creates a product risk if the second step fails.
- Report sharing exists, but report recipients need clearer data context, freshness, and permission expectations.
- Public docs exist, but users need clearer controls around expiry, revocation, indexing, and sensitivity.

## Trust Pitfalls

- Audit trails can be purged or modified through APIs, which weakens compliance credibility.
- Webhook delivery appears in-process rather than durable, so users may lose integration events during restarts or failures.
- Import jobs and locks appear in-memory, which can break across restarts or multiple workers.
- Rate limiting and realtime streams are in-memory, which limits horizontal scaling expectations.
- Local attachment storage can be risky for production, backups, malware scanning, and multi-node deployments.
- AI generation can produce plausible but incorrect test cases unless review requirements are explicit.
- AI retrieval is not semantically deep enough for very large projects if it relies heavily on lexical matching.
- Best-effort side effects such as notifications and webhooks can make the product feel unreliable if users expect guaranteed delivery.

## UX Pitfalls

- Some pages have stronger offline and retry behavior than others, making reliability feel inconsistent.
- Some user-facing strings remain hardcoded or untranslated, weakening the internationalization promise.
- Profile defaults can look like real personal data if placeholder values are shown as saved profile content.
- Admin and settings pages can feel too similar in naming and page framing.
- Issue tracker setup inside defects may conflict with integrations settings elsewhere.
- Users may not notice that reports can be scoped by milestone or test plan.
- Users may not notice work inbox, notifications, comments, review requests, and watchers as one collaboration system.
- Empty states need stronger next steps that match the user's role and current maturity.
- Error messages need to consistently say what happened, whether data was saved, and what the user should do next.

## Market Positioning Pitfalls

- Competing with Jira, TestRail, Zephyr, Xray, qTest, and Linear requires a sharper wedge than broad feature parity.
- AI claims need measurable outcomes: faster case creation, fewer duplicate tests, higher coverage, reduced escaped defects.
- Without enterprise auth and compliance, large teams may treat the app as a trial tool rather than a system of record.
- Without an automation story, the product may look manual-first to modern QA teams.
- Without pricing and limits, admins cannot evaluate operational adoption risks.

## Evidence-Backed Pitfalls From The Deep Dive

- Product settings may overpromise control if feature toggles hide list pages but leave detail/edit pages accessible.
- Viewer users can encounter “permission by error” if CTAs remain visible and the backend rejects them later.
- A visible navigation item that redirects elsewhere trains users not to trust the sidebar.
- Fake profile data can create privacy anxiety and support tickets.
- Webhooks look enterprise-ready because delivery records and HMAC exist, but daemon-thread retry is not enough for mission-critical integrations.
- Import/export may look job-based, but in-memory job state can disappear after restart.
- AI Manager can configure source behavior that the assistant UI may not expose, weakening admin trust.
- A separate `doc_revisions` feature flag can confuse admins if it is not enforced as a separate capability.
- Two backend defect surfaces can create inconsistent documentation, SDK, reporting, and integration behavior.

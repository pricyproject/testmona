# Evidence-Backed Findings

This file lists high-confidence product findings observed from the implemented frontend and backend code. Each item includes product impact and source evidence so it can become a product, design, or engineering ticket.

## Critical Findings

### 1. Feature Toggles Do Not Fully Protect Deep Links

**What happens:** Sidebar hides disabled modules, but many detail/edit routes are not wrapped in the matching feature guard.

**User impact:** Admins may believe a module is disabled, while users can still open bookmarked links, notification links, inbox links, or direct URLs into that module.

**Evidence:**

- Test case list is guarded, but test case detail/edit/revisions/history/execute routes are not guarded: `frontend/src/App.tsx:288-319`.
- Requirements list is guarded, but requirement detail is not: `frontend/src/App.tsx:367-385`.
- Doc Hub list and release notes are guarded, but doc detail/revisions/edit are not: `frontend/src/App.tsx:386-414`.
- Defects list and root-cause route are guarded, but defect detail is not: `frontend/src/App.tsx:415-432`.
- Test plan, milestone, and test run detail routes are also not consistently guarded after their list routes: `frontend/src/App.tsx:320-355`, `frontend/src/App.tsx:448-486`.

**Product recommendation:** Treat feature toggles as enforceable product entitlements. Guard collection, detail, edit, execute, report, revision, and redirect routes consistently.

### 2. Global Environments Navigation Is A Dead Path

**What happens:** Sidebar shows a global Environments item when projects exist but no project is selected, but the route redirects to Projects.

**User impact:** Users click a visible navigation item and are sent somewhere else. This creates low trust in navigation.

**Evidence:**

- Sidebar link points to `/environments`: `frontend/src/components/Sidebar.tsx:112-115`.
- App redirects `/environments` to `/projects`: `frontend/src/App.tsx:568`.

**Product recommendation:** Either remove the global Environments item from that state or implement a real global environments page.

### 3. Read-Only Users May See Write Controls

**What happens:** Some pages show create/edit/bulk controls without consistently checking write permissions.

**User impact:** Viewers can be invited into actions that later fail with 403 errors. The product feels broken even if the backend blocks the mutation correctly.

**Evidence:**

- Requirements page exposes create and many edit/bulk actions while only delete is clearly manager-gated in several places: `frontend/src/pages/Requirements.tsx:1985-1993`, `frontend/src/pages/Requirements.tsx:2298-2379`, `frontend/src/pages/Requirements.tsx:2513-2520`.
- TestRuns header create is gated, but the empty-state create button is not: `frontend/src/pages/TestRuns.tsx:765-773`, `frontend/src/pages/TestRuns.tsx:1372-1375`.
- Defects page gates “Report Defect,” but integrations, bulk edit, and row edit/delete controls are less consistently gated: `frontend/src/pages/Defects.tsx:1637-1755`, `frontend/src/pages/Defects.tsx:2181-2189`, `frontend/src/pages/Defects.tsx:2401-2424`.
- DocHub gates “New doc,” but empty-space create, folder create, and import controls are broader: `frontend/src/pages/DocHub.tsx:937-944`, `frontend/src/pages/DocHub.tsx:1024-1030`, `frontend/src/pages/DocHub.tsx:1249-1265`.

**Product recommendation:** Add a permission-aware action visibility standard. Every CTA should answer: can this user do it, why not, and how can they request access?

### 4. Profile Shows Fake Personal Data Defaults

**What happens:** Empty user profile fields default to realistic fake values.

**User impact:** Users may believe TestMona has invented or stored incorrect personal data. This is especially bad for trust and privacy perception.

**Evidence:**

- Initial profile state includes fake bio, location, website, and company: `frontend/src/pages/Profile.tsx:206-214`.
- User update fallback repeats those fake values: `frontend/src/pages/Profile.tsx:222-230`.

**Product recommendation:** Empty profile fields should stay empty and use placeholders only inside form controls.

### 5. Signup Disabled Funnel Is Incomplete

**What happens:** Login checks `signup_enabled` to hide the signup link, but direct `/signup` still renders the signup form.

**User impact:** A user can reach a form for a disabled action, submit, and then receive a backend error.

**Evidence:**

- Login checks signup setting: `frontend/src/pages/Login.tsx:54-66`.
- Unauthenticated app always routes `/signup` to Signup when setup is complete: `frontend/src/App.tsx:159-168`.
- Signup page does not check the public signup setting before rendering: `frontend/src/pages/Signup.tsx:22-197`.

**Product recommendation:** Direct `/signup` should show a disabled-registration message or redirect when signup is off.

### 6. Password Policy Is Inconsistent Between Frontend Signup And Backend

**What happens:** Signup checks minimum password length of 6, while backend requires 8 and letters plus numbers.

**User impact:** Users can pass frontend validation and then fail backend validation, making the form feel unreliable.

**Evidence:**

- Frontend minimum is 6: `frontend/src/pages/Signup.tsx:52-54`.
- Backend minimum is 8 and requires letters plus numbers: `backend/app/auth.py:27-41`.

**Product recommendation:** Use the same password policy and helper copy in setup, signup, profile password change, and backend validation.

### 7. Doc Revision Feature Toggle Is Not Clearly Enforced

**What happens:** `doc_revisions` exists as a project feature, but the doc revisions route does not use it.

**User impact:** Admins can toggle a feature that appears not to fully control the product experience.

**Evidence:**

- Feature exists in the frontend catalog: `frontend/src/lib/projectFeatures.ts:32-51`, `frontend/src/lib/projectFeatures.ts:64-84`.
- Doc revisions route is not wrapped with `FeatureGuard feature="doc_revisions"`: `frontend/src/App.tsx:405-408`.

**Product recommendation:** Either enforce `doc_revisions` on revision surfaces or remove it as a separate toggle if it is part of Doc Hub.

### 8. Defect Product Has Two Backend Surfaces

**What happens:** There are classic `/defects` endpoints and richer project-scoped `/projects/{project_id}/defects-management` endpoints.

**User impact:** Product and API semantics can diverge: comments, attachments, templates, history, and tracker integrations may live in a different defect model than the main defect UI.

**Evidence:**

- Classic defect endpoints start in `backend/app/routes/requirements_defects_plans.py:1893-2059`.
- Rich defect management endpoints start in `backend/app/api/defect_management.py:170-319` and continue through comments, attachments, history, integrations, and templates.

**Product recommendation:** Decide whether rich defect management replaces classic defects, extends the same entity, or remains an internal API. The end-user product should have one defect concept.

### 9. Webhook Event Coverage Is Too Small For The Product Surface

**What happens:** Webhooks support only three business events.

**User impact:** Integrations cannot react to most important lifecycle changes: requirements, test cases, test runs started, results changed, docs reviewed, defects closed, milestones updated, plans changed, comments, mentions, and approvals.

**Evidence:**

- Supported events are only `test_run.completed`, `defect.created`, and `defect.updated`: `backend/app/services/webhook_service.py:40-44`.
- Supported events are exposed publicly through `/webhooks/supported-events`: `backend/app/routes/tokens_webhooks.py:96-100`.

**Product recommendation:** Expand event catalog and group events by domain with examples and payload previews.

### 10. Webhooks Are Not Durable Enough For Enterprise Integration Expectations

**What happens:** Webhook delivery rows are persisted, but retries run in daemon threads inside the web process.

**User impact:** Delivery can be interrupted by process restarts. There is no dedicated queue worker, delay scheduling, dead-letter queue, or operational dashboard.

**Evidence:**

- Design notes explicitly say no separate worker and threading-based runner: `backend/app/services/webhook_service.py:5-11`.
- Delivery spawns a daemon thread: `backend/app/services/webhook_service.py:164-187`.
- Business operations call webhook delivery best-effort and never raise: `backend/app/services/webhook_service.py:190-199`.

**Product recommendation:** Move webhook delivery to a durable queue and expose delivery health, retries, dead letters, and replay.

### 11. Import Job State Is In Memory

**What happens:** Import jobs, idempotency records, and locks are process memory dictionaries.

**User impact:** Large imports can lose status on restart; duplicate protection can fail across replicas; multi-worker deployments can run conflicting imports.

**Evidence:**

- `IMPORT_JOBS`, `IDEMPOTENCY_RECORDS`, and `IMPORT_LOCKS` are dictionaries: `backend/app/services/import_export_utils.py:21-23`.

**Product recommendation:** Persist job state and idempotency records, then show a real import/export job monitor.

### 12. Realtime Notifications Are Best-Effort And Single-Process

**What happens:** SSE notification fanout is intentionally in-memory and single-process.

**User impact:** In multi-replica deployments, users may not receive realtime updates consistently. Polling may recover, but the realtime promise is weaker.

**Evidence:**

- Service comments state it is in-memory and single-process: `backend/app/services/realtime_service.py:1-14`.
- Subscriber registry is a process-local dictionary: `backend/app/services/realtime_service.py:26-32`.

**Product recommendation:** Use Redis pub/sub, database notifications, or a message broker for multi-node realtime.

### 13. Rate Limiting Is In Memory

**What happens:** Rate limit counters are stored per process.

**User impact:** Limits are inconsistent across multiple replicas and reset on restart.

**Evidence:**

- Middleware stores requests in `self.requests = defaultdict(list)`: `backend/app/middleware.py:33-74`.

**Product recommendation:** Use shared rate limiting for production, such as Redis-backed counters or gateway-level limits.

### 14. i18n Coverage Is Not Complete

**What happens:** Some active keys are missing in Arabic and Persian, and several strings are hardcoded.

**User impact:** Arabic and Persian users see English or raw keys in advanced areas, weakening the product’s RTL/i18n promise.

**Evidence:**

- ProjectGuard includes hardcoded “No Projects Found” and “Go to Projects”: `frontend/src/components/ProjectGuard.tsx:115-127`.
- TestRuns includes hardcoded English error strings: `frontend/src/pages/TestRuns.tsx:366-416`.
- Test Asset Health uses keys that were found missing from Arabic/Persian locale files in the deep scan.

**Product recommendation:** Add a locale key parity check in CI and disallow hardcoded user-facing strings in product pages.

### 15. AI Source Configuration And Assistant UI Are Not Fully Aligned

**What happens:** AI Manager exposes docs as a source type, but the requirement chat source selector excludes docs.

**User impact:** Admins may configure AI source routing that users cannot actually select in the assistant UI.

**Evidence:**

- AI Manager source options include docs: `frontend/src/pages/settings/tabs/AIManagerTab.tsx:70`.
- Requirement chat source type list excludes docs while feature mapping mentions it: `frontend/src/components/requirements/RequirementChat.tsx:54-66`.

**Product recommendation:** Define a single AI source taxonomy and use it across AI Manager, Ask Project, requirement chat, Doc Hub AI, and backend source routing.

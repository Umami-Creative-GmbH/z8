# Docs App Full Refresh Design

## Context

Recent project documentation under `docs/superpowers/plans` and `docs/superpowers/specs` records a broad set of new product, admin, manager, mobile, enterprise, and operational workflows added between 2026-04-27 and 2026-05-08. The public docs app under `apps/docs` has not kept pace with those additions.

The docs app currently has strong baseline coverage for employee time tracking, vacations, admin people/settings pages, integrations, enterprise setup, technical architecture, and desktop app usage. It also has clear gaps: manager docs are thin, several product routes have no dedicated guide page, existing guide index links still point at the old `/docs/ui/...` path, and screenshots are sparse or unused.

## Goals

- Refresh the docs app so recent user-facing and admin-facing additions are discoverable in the public guide.
- Preserve the existing role-based guide structure: user, manager, admin, desktop, and tech docs.
- Add meaningful documentation for recent workflows instead of creating placeholder-only pages.
- Fix stale navigation and broken internal links.
- Add or reuse screenshot references only when the referenced image exists.
- Clearly separate product guide content from technical/internal implementation details.

## Non-Goals

- Do not document every implementation detail from the superpowers plans/specs.
- Do not fabricate screenshots or add screenshot references to files that do not exist.
- Do not require access to Phase CLI variables or tenant-specific secrets.
- Do not restructure the entire docs app shell unless needed for navigation correctness.
- Do not create a dedicated page for every small UI refinement when the content belongs naturally in an existing workflow page.

## Approach

Use a full coverage pass with prioritized depth.

Core workflows get dedicated pages or substantial page updates. Smaller UI improvements are folded into the closest existing page. This avoids both stale docs and navigation bloat.

## Information Architecture

### User Guide

Add or update employee-facing content for:

- Dashboard and daily overview.
- Time tracking reminders and personal workday timeline.
- Absence planning, holiday tooltips, and mobile holiday visibility.
- My Requests as the employee request status hub.
- Travel expenses from the employee perspective.
- Notifications inbox, notification preferences, and mobile switch layout.
- Account security, including user-facing 2FA/passkey behavior if available in the app.
- Profile/mobile preference refinements, including profile picture actions and week-start preference where applicable.

Expected new pages:

- `apps/docs/content/docs/guide/user-guide/dashboard.mdx`
- `apps/docs/content/docs/guide/user-guide/my-requests.mdx`
- `apps/docs/content/docs/guide/user-guide/travel-expenses.mdx`

Expected updates:

- `apps/docs/content/docs/guide/user-guide/index.mdx`
- `apps/docs/content/docs/guide/user-guide/time-tracking.mdx`
- `apps/docs/content/docs/guide/user-guide/vacation.mdx`
- `apps/docs/content/docs/guide/user-guide/notifications.mdx`
- `apps/docs/content/docs/guide/user-guide/account-security.mdx`
- `apps/docs/content/docs/guide/user-guide/meta.json`

### Manager Guide

Expand the manager guide beyond the current overview and coverage-targets pages.

Manager content should cover:

- Approval inbox workflow and filtered approvals.
- Team manager approval fallback behavior.
- Manager daily briefing and manager today counts.
- Coverage targets, scheduling, and shift/request context.
- Team reports and exports from a manager perspective.

Expected new pages:

- `apps/docs/content/docs/guide/manager-guide/approvals.mdx`
- `apps/docs/content/docs/guide/manager-guide/dashboard.mdx`
- `apps/docs/content/docs/guide/manager-guide/scheduling.mdx`
- `apps/docs/content/docs/guide/manager-guide/reports.mdx`

Expected updates:

- `apps/docs/content/docs/guide/manager-guide/index.mdx`
- `apps/docs/content/docs/guide/manager-guide/coverage-targets.mdx`
- `apps/docs/content/docs/guide/manager-guide/meta.json`

### Admin Guide

Add or update organization-admin content for recent configuration, compliance, import, enterprise, and rollout workflows.

Admin content should cover:

- Approval policies and custom approval policy builder behavior.
- Import quality review and Clockodo/import workflows.
- Payroll readiness checklist and export blockers/warnings.
- Contract and work model management.
- Certification and qualification tracking.
- Notification channel settings and system notifications.
- SSO/SCIM enterprise identity setup wizard.
- Multi-entity organization management if implemented as a user-visible admin workflow.
- Implementation checklist for new customers.
- Email template defaults only where admin-visible template editing exists.

Expected new pages:

- `apps/docs/content/docs/guide/admin-guide/approval-policies.mdx`
- `apps/docs/content/docs/guide/admin-guide/imports.mdx`
- `apps/docs/content/docs/guide/admin-guide/implementation-checklist.mdx`
- `apps/docs/content/docs/guide/admin-guide/work-models.mdx`
- `apps/docs/content/docs/guide/admin-guide/multi-entity-organizations.mdx` if the feature is exposed in the app.

Expected updates:

- `apps/docs/content/docs/guide/admin-guide/index.mdx`
- `apps/docs/content/docs/guide/admin-guide/employee-management.mdx`
- `apps/docs/content/docs/guide/admin-guide/skills-qualifications.mdx`
- `apps/docs/content/docs/guide/admin-guide/work-policies.mdx`
- `apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx`
- `apps/docs/content/docs/guide/admin-guide/analytics-and-exports.mdx`
- `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`
- `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`
- `apps/docs/content/docs/guide/admin-guide/system-administration.mdx`
- `apps/docs/content/docs/guide/admin-guide/meta.json`

### Technical Docs

Technical docs should only be updated when product guide changes expose a new technical concept that admins or operators need to understand.

Likely updates:

- Add concise references in enterprise/auth docs if SCIM/SSO setup behavior changed.
- Add concise service/data model notes only for import quality review, approval policies, or payroll readiness if current technical pages are materially stale.

## Navigation And Link Rules

- Replace old `/docs/ui/...` links with `/docs/guide/...` links.
- Add new pages to the relevant `meta.json` files in role-appropriate sections.
- Keep deprecated pages only where they help users find replacement workflows.
- Prefer cross-links over duplicating long explanations across user, manager, and admin pages.

## Screenshot Strategy

Existing image files may be reused where they match current UI:

- `apps/docs/public/images/user-guide/dashboard-page.png`
- `apps/docs/public/images/user-guide/reports-page.png`
- `apps/docs/public/images/user-guide/approvals-page.png`
- Existing referenced admin and user guide screenshots.

New screenshot references should only be added after the image exists under `apps/docs/public/images`. If the app server, auth, or demo data is unavailable, document the workflow in prose and leave screenshot capture as a follow-up rather than adding placeholders.

High-priority screenshot refresh candidates:

- User dashboard.
- Time tracking page with reminder panel.
- Absence request/planner page with holiday context.
- My Requests page.
- Approval inbox.
- Approval policies settings.
- Imports/import review.
- Payroll export/readiness.
- SCIM/enterprise identity setup.

## Content Rules

- Write for the role performing the workflow.
- Use clear operational language and avoid implementation jargon in guide pages.
- Call out organization scoping where it affects access, setup, approvals, imports, or enterprise integrations.
- Mention permissions only when the user needs them to complete the workflow.
- Avoid tenant-specific environment variable guidance in product guide pages.
- Keep technical file names, routes, and internal service names in technical docs unless an admin needs a route to navigate the product.

## Verification

After implementation, verify:

- All new MDX files are included in the appropriate `meta.json` navigation.
- No `/docs/ui/...` links remain under `apps/docs/content/docs`.
- Every added image reference starts with `/images/` and points to an existing file under `apps/docs/public/images`.
- The docs app builds or runs the most targeted available docs check that does not require unavailable secrets.
- If screenshots are refreshed, each screenshot is captured from the real app with English locale and avoids private data.

## Open Decisions For Implementation

- Confirm whether multi-entity organization management is implemented as a visible admin workflow before adding a full guide page. If it is not visible, mention it only in technical or future-facing notes.
- Confirm whether 2FA/passkeys are exposed to ordinary users before expanding account security with step-by-step setup instructions.
- Confirm whether existing browser extension/store references are still accurate before editing that page.
- Confirm whether data warehousing/Snowflake/BigQuery references correspond to current product routes before retaining or revising them.

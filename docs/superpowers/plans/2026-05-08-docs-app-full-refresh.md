# Docs App Full Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create git commits unless the user explicitly asks for commits.

**Goal:** Refresh the public docs app so recent user, manager, admin, enterprise, and operational features are discoverable and accurately documented.

**Architecture:** Keep the existing Fumadocs content architecture and role-based navigation. Add focused MDX pages for major workflows, fold smaller UI refinements into existing pages, and update `meta.json` files so navigation remains clear.

**Tech Stack:** Fumadocs MDX, Next.js docs app, JSON navigation metadata, Markdown image references under `apps/docs/public/images`.

---

## File Structure

### Create

- `apps/docs/content/docs/guide/user-guide/dashboard.mdx`: employee dashboard and daily overview guide.
- `apps/docs/content/docs/guide/user-guide/my-requests.mdx`: employee request status hub guide.
- `apps/docs/content/docs/guide/user-guide/travel-expenses.mdx`: employee travel expense workflow guide.
- `apps/docs/content/docs/guide/manager-guide/approvals.mdx`: manager approval inbox and fallback approval guide.
- `apps/docs/content/docs/guide/manager-guide/dashboard.mdx`: manager daily briefing and today counts guide.
- `apps/docs/content/docs/guide/manager-guide/scheduling.mdx`: scheduling, coverage, and shift/request context guide.
- `apps/docs/content/docs/guide/manager-guide/reports.mdx`: manager reporting and export guide.
- `apps/docs/content/docs/guide/admin-guide/approval-policies.mdx`: approval policy configuration guide.
- `apps/docs/content/docs/guide/admin-guide/imports.mdx`: import and import quality review guide.
- `apps/docs/content/docs/guide/admin-guide/implementation-checklist.mdx`: new customer implementation checklist guide.
- `apps/docs/content/docs/guide/admin-guide/work-models.mdx`: contracts and work model history guide.

### Modify

- `apps/docs/content/docs/index.mdx`: replace stale `/docs/ui/...` links.
- `apps/docs/content/docs/guide/getting-started/index.mdx`: replace stale `/docs/ui/...` links.
- `apps/docs/content/docs/guide/user-guide/index.mdx`: replace stale links and add new feature cards.
- `apps/docs/content/docs/guide/user-guide/meta.json`: add new user-guide pages.
- `apps/docs/content/docs/guide/user-guide/time-tracking.mdx`: add reminders panel and personal workday timeline content.
- `apps/docs/content/docs/guide/user-guide/vacation.mdx`: add absence planner, holiday tooltip, and mobile holiday context.
- `apps/docs/content/docs/guide/user-guide/notifications.mdx`: add inbox and preference/channel behavior.
- `apps/docs/content/docs/guide/user-guide/account-security.mdx`: add cautious 2FA/passkey section only if current app/docs confirm availability.
- `apps/docs/content/docs/guide/manager-guide/index.mdx`: convert broad overview into a gateway with links to dedicated pages.
- `apps/docs/content/docs/guide/manager-guide/coverage-targets.mdx`: cross-link scheduling and approvals context.
- `apps/docs/content/docs/guide/manager-guide/meta.json`: add manager pages.
- `apps/docs/content/docs/guide/admin-guide/index.mdx`: add links for new admin workflows.
- `apps/docs/content/docs/guide/admin-guide/meta.json`: add admin pages in role-appropriate sections.
- `apps/docs/content/docs/guide/admin-guide/employee-management.mdx`: cross-link work models and qualifications.
- `apps/docs/content/docs/guide/admin-guide/skills-qualifications.mdx`: add renewal/evidence tracking context.
- `apps/docs/content/docs/guide/admin-guide/work-policies.mdx`: link work models and approval policies where relevant.
- `apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx`: add absence planning and holiday visibility context.
- `apps/docs/content/docs/guide/admin-guide/analytics-and-exports.mdx`: remove or qualify unverified data warehousing claims.
- `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`: add payroll readiness checklist context.
- `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`: align SCIM wording with enterprise identity setup wizard.
- `apps/docs/content/docs/guide/admin-guide/system-administration.mdx`: add notification channels and email template defaults if admin-visible.

---

### Task 1: Fix Stale Docs Links

**Files:**
- Modify: `apps/docs/content/docs/index.mdx`
- Modify: `apps/docs/content/docs/guide/getting-started/index.mdx`
- Modify: `apps/docs/content/docs/guide/user-guide/index.mdx`

- [ ] **Step 1: Locate stale links**

Run: `rg '/docs/ui/' apps/docs/content/docs`

Expected: matches in the three files listed above.

- [ ] **Step 2: Replace links**

Use these replacements exactly:

```text
/docs/ui/getting-started -> /docs/guide/getting-started
/docs/ui/user-guide -> /docs/guide/user-guide
/docs/ui/user-guide/getting-started -> /docs/guide/user-guide/getting-started
/docs/ui/user-guide/time-tracking -> /docs/guide/user-guide/time-tracking
/docs/ui/user-guide/calendar -> /docs/guide/user-guide/calendar
/docs/ui/user-guide/notifications -> /docs/guide/user-guide/notifications
/docs/ui/user-guide/vacation -> /docs/guide/user-guide/vacation
/docs/ui/user-guide/wellness -> /docs/guide/user-guide/wellness
/docs/ui/user-guide/faq -> /docs/guide/user-guide/faq
/docs/ui/manager-guide -> /docs/guide/manager-guide
/docs/ui/admin-guide -> /docs/guide/admin-guide
```

- [ ] **Step 3: Verify stale links are gone**

Run: `rg '/docs/ui/' apps/docs/content/docs`

Expected: no matches.

---

### Task 2: Add User Guide Pages And Navigation

**Files:**
- Create: `apps/docs/content/docs/guide/user-guide/dashboard.mdx`
- Create: `apps/docs/content/docs/guide/user-guide/my-requests.mdx`
- Create: `apps/docs/content/docs/guide/user-guide/travel-expenses.mdx`
- Modify: `apps/docs/content/docs/guide/user-guide/meta.json`
- Modify: `apps/docs/content/docs/guide/user-guide/index.mdx`

- [ ] **Step 1: Create dashboard guide**

Create `dashboard.mdx` with this content:

```mdx
---
title: Dashboard
description: Understand your daily overview, widgets, and time-related signals.
---

# Dashboard

The dashboard is the first place to check what needs your attention today. It brings together your time tracking state, upcoming schedule context, open requests, notifications, and useful shortcuts.

![Dashboard overview](/images/user-guide/dashboard-page.png)

## What To Check First

- **Current status** - Confirm whether you are clocked in, on break, or off work.
- **Today overview** - Review planned hours, recorded time, breaks, and any warnings.
- **Requests** - Check whether absences, corrections, or travel expenses need action.
- **Notifications** - Review new approvals, reminders, and organization messages.

## Daily Use

Use the dashboard as a starting point rather than a replacement for detailed pages. Open Time Tracking for precise clock actions, My Requests for request history, Calendar for schedule context, and Notifications for message management.

## Mobile Notes

On smaller screens, dashboard cards stack vertically. Start with the current status card, then review requests and notifications before moving into detailed workflows.
```

- [ ] **Step 2: Create My Requests guide**

Create `my-requests.mdx` with this content:

```mdx
---
title: My Requests
description: Track absences, time corrections, travel expenses, and approval decisions in one place.
---

# My Requests

My Requests is your personal status hub for workflows that need review or approval. Use it to check submitted absences, time corrections, travel expenses, shift requests, and manager decisions.

## When To Use It

- You submitted a request and want to see the current status.
- A manager asked for changes or more information.
- You need to confirm whether a request was approved, rejected, or canceled.
- You want to find older decisions without searching separate feature pages.

## Request Statuses

- **Pending** - The request is waiting for review.
- **Approved** - The request was accepted and can be reflected in planning, payroll, or reporting.
- **Rejected** - The request was declined. Read the decision note before submitting another request.
- **Needs changes** - Update the request with the requested information.
- **Canceled** - The request was withdrawn and no longer needs review.

## Working With Requests

Open a request to review its details, decision history, comments, and related dates. If your organization uses approvals for multiple request types, use filters to narrow the list by type or status.

## Good Practice

Review My Requests before contacting a manager about a decision. The page usually shows the latest known state and any notes left during review.
```

- [ ] **Step 3: Create travel expenses guide**

Create `travel-expenses.mdx` with this content:

```mdx
---
title: Travel Expenses
description: Submit and track travel expense claims.
---

# Travel Expenses

Travel expenses let you submit work-related costs for review when your organization enables this workflow. Claims may include mileage, meals, lodging, transit, or other categories configured by your admins.

## Before You Submit

- Confirm the expense is related to work.
- Add the correct date, amount, category, and description.
- Attach receipt evidence if your organization requires it.
- Check whether the expense belongs to a project, customer, or cost center.

## Submit A Claim

1. Open **Travel Expenses** from the app navigation.
2. Select **New expense** or the equivalent create action.
3. Enter the expense details.
4. Attach receipt evidence when required.
5. Submit the claim for review.

## Track Review

After submission, check **My Requests** for the current approval status. If a manager opens approvals from the Travel Expenses page, the approval inbox can be filtered to travel expense requests.

## Corrections

If a claim needs changes, open the request details, review the manager note, and submit the corrected information. Do not create a duplicate claim unless your organization asks you to.
```

- [ ] **Step 4: Update user navigation**

Modify `user-guide/meta.json` so the `pages` array includes the new pages in this order under `---Features---`:

```json
"dashboard",
"time-tracking",
"calendar",
"calendar-sync",
"my-requests",
"notifications",
"vacation",
"travel-expenses",
"wellness",
"desktop-app",
"browser-extension"
```

- [ ] **Step 5: Update user guide landing page**

Add cards or links for Dashboard, My Requests, and Travel Expenses in `user-guide/index.mdx`. Use these destinations:

```text
/docs/guide/user-guide/dashboard
/docs/guide/user-guide/my-requests
/docs/guide/user-guide/travel-expenses
```

---

### Task 3: Update Existing User Workflow Pages

**Files:**
- Modify: `apps/docs/content/docs/guide/user-guide/time-tracking.mdx`
- Modify: `apps/docs/content/docs/guide/user-guide/vacation.mdx`
- Modify: `apps/docs/content/docs/guide/user-guide/notifications.mdx`
- Modify: `apps/docs/content/docs/guide/user-guide/account-security.mdx`

- [ ] **Step 1: Add time tracking refinements**

In `time-tracking.mdx`, add a section named `## Reminders And Timeline` after the main clocking instructions:

```mdx
## Reminders And Timeline

The time tracking page may show reminder cards for breaks, hydration, or other organization-configured prompts. Treat these as operational guidance: they help you keep records accurate, but they do not replace your organization's time policy.

Your personal workday timeline shows the sequence of clock-in, break, resume, and clock-out events for the day. Use it to spot missing actions before the end of the workday.

On mobile, review the current status and next recommended action before opening detailed history. This keeps clock actions quick while still making corrections visible.
```

- [ ] **Step 2: Add absence planning refinements**

In `vacation.mdx`, add a section named `## Planning With Holidays` near the request planning instructions:

```mdx
## Planning With Holidays

When holidays affect your absence period, Z8 can show holiday context directly in the planning view. Holiday names and assigned holiday calendars help you understand which days count against your balance.

Use the preview before submitting a request. It can help you check balance impact, schedule conflicts, and coverage risk before the request reaches a manager.

On mobile, holiday information should remain visible near the affected absence dates so you do not need to compare separate calendar screens.
```

- [ ] **Step 3: Add notification inbox content**

In `notifications.mdx`, add a section named `## Notification Inbox`:

```mdx
## Notification Inbox

The notification inbox collects product messages, approval updates, reminders, and integration-related notifications. Use search and filters to find a specific message or narrow the list by status.

If bulk actions are available, use them for routine cleanup such as marking several messages as read. Keep unread messages for items you still need to review.

Notification preferences control which channels are used for different message types. Depending on your organization's setup, channels can include in-app, email, push, or chat integrations.
```

- [ ] **Step 4: Add cautious account security content**

In `account-security.mdx`, add this section only if the existing page or product routes indicate 2FA/passkeys are available to users. If not confirmed, skip this step and note it in the final summary.

```mdx
## Additional Sign-In Protection

If your organization enables stronger authentication, your account settings may include options such as two-factor authentication or passkeys.

Use two-factor authentication when you want a second verification step during sign-in. Use passkeys when your device and browser support passwordless sign-in. Keep recovery options current so you can regain access if a device is lost.
```

---

### Task 4: Add Manager Guide Pages And Navigation

**Files:**
- Create: `apps/docs/content/docs/guide/manager-guide/approvals.mdx`
- Create: `apps/docs/content/docs/guide/manager-guide/dashboard.mdx`
- Create: `apps/docs/content/docs/guide/manager-guide/scheduling.mdx`
- Create: `apps/docs/content/docs/guide/manager-guide/reports.mdx`
- Modify: `apps/docs/content/docs/guide/manager-guide/meta.json`
- Modify: `apps/docs/content/docs/guide/manager-guide/index.mdx`

- [ ] **Step 1: Create manager approvals guide**

Create `approvals.mdx` with this content:

```mdx
---
title: Approvals
description: Review absence, correction, shift, and travel expense requests assigned to you.
---

# Approvals

The approval inbox gives managers one place to review requests from their teams. Depending on organization settings, approvals can include absences, time corrections, shift requests, travel expenses, and other operational workflows.

![Approval inbox](/images/user-guide/approvals-page.png)

## Review Flow

1. Open the **Approval Inbox**.
2. Filter by request type, status, or team when needed.
3. Open a request and review dates, comments, attachments, and policy context.
4. Approve, reject, or request changes with a clear decision note.

## Team Manager Fallback

If an employee belongs to multiple teams, approval routing can use the employee's primary team manager first. When no primary manager is available, Z8 can fall back to another eligible team manager according to the organization's approval setup.

## Decision Quality

Use decision notes for rejected or changed requests. Clear notes reduce duplicate submissions and help employees understand what to correct.
```

- [ ] **Step 2: Create manager dashboard guide**

Create `dashboard.mdx` with this content:

```mdx
---
title: Manager Dashboard
description: Use daily briefing signals and today counts to focus manager attention.
---

# Manager Dashboard

The manager dashboard highlights operational issues that may need attention today. It is designed for quick triage before opening detailed team views.

## Today Counts

Today counts summarize urgent manager work such as pending approvals, time exceptions, coverage risks, and compliance-sensitive issues. Use them to decide what to review first.

## Daily Briefing

The daily briefing groups the most important team signals into a short operational overview. Review it at the start of the day and after major schedule changes.

## Follow-Up

Open the linked workflow from each count or briefing item. For example, use approvals for pending requests, scheduling for coverage issues, and reports for broader trends.
```

- [ ] **Step 3: Create scheduling guide**

Create `scheduling.mdx` with this content:

```mdx
---
title: Scheduling And Coverage
description: Review coverage targets, shifts, and team availability.
---

# Scheduling And Coverage

Managers use scheduling and coverage views to understand whether planned staffing matches operational needs.

## Coverage Targets

Coverage targets define expected staffing levels for a period, team, location, or role. Review target gaps before approving absences or shift changes.

## Shift And Request Context

When shift requests are enabled, review the request together with team availability and coverage impact. Avoid approving a change that creates an uncovered critical period.

## Absence Impact

Before approving absence requests, check whether the absence overlaps holidays, high-demand days, or already approved team absences.
```

- [ ] **Step 4: Create manager reports guide**

Create `reports.mdx` with this content:

```mdx
---
title: Manager Reports
description: Review team-level time, absence, and operational reports.
---

# Manager Reports

Manager reports help you understand team trends without requiring full organization-admin access.

![Reports page](/images/user-guide/reports-page.png)

## Common Reports

- Time totals and exceptions.
- Absence patterns and upcoming time off.
- Project or location summaries when available to your role.
- Approval volume and decision trends.

## Exporting

If exports are enabled for your role, export only the data needed for the operational task. Organization-wide payroll or compliance exports usually belong to admin workflows.
```

- [ ] **Step 5: Update manager navigation**

Set `manager-guide/meta.json` pages to:

```json
["index", "dashboard", "approvals", "scheduling", "coverage-targets", "reports"]
```

- [ ] **Step 6: Update manager landing page**

Revise `manager-guide/index.mdx` so it links to the new pages and keeps only a concise role overview. Do not duplicate the full approval and reporting instructions from the dedicated pages.

---

### Task 5: Add Admin Guide Pages And Navigation

**Files:**
- Create: `apps/docs/content/docs/guide/admin-guide/approval-policies.mdx`
- Create: `apps/docs/content/docs/guide/admin-guide/imports.mdx`
- Create: `apps/docs/content/docs/guide/admin-guide/implementation-checklist.mdx`
- Create: `apps/docs/content/docs/guide/admin-guide/work-models.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/meta.json`
- Modify: `apps/docs/content/docs/guide/admin-guide/index.mdx`

- [ ] **Step 1: Create approval policies guide**

Create `approval-policies.mdx` with this content:

```mdx
---
title: Approval Policies
description: Configure organization-scoped approval routing for operational requests.
---

# Approval Policies

Approval policies define who reviews requests and in what order. They keep absence, correction, overtime, travel, and other approval workflows predictable across the organization.

## What Policies Control

- Which request types need approval.
- Which roles or managers review each request.
- Whether approvals are sequential or can be handled by any eligible reviewer.
- How fallback reviewers are selected when the primary reviewer is unavailable.

## Team Manager Routing

For team-based approvals, use primary team manager assignments where possible. If an employee belongs to multiple teams, routing should stay clear enough that both employees and managers know who is responsible for the decision.

## Safe Changes

Change approval policies carefully. Before enabling a new policy, confirm the affected teams, request types, and fallback behavior. After a change, review pending requests to make sure they still have an eligible reviewer.
```

- [ ] **Step 2: Create imports guide**

Create `imports.mdx` with this content:

```mdx
---
title: Imports
description: Review imported time and operational data before applying it.
---

# Imports

Imports help admins bring external time and operational data into Z8. Use import review before applying data so duplicates, gaps, and unmatched records do not become payroll or compliance problems.

## Import Quality Review

The import quality review step highlights issues such as:

- Duplicate entries.
- Missing required fields.
- Unmatched employees, projects, locations, or categories.
- Time gaps or overlaps.
- Records that need manual confirmation.

## Review Flow

1. Upload or start the import from the configured source.
2. Review the quality summary.
3. Resolve blockers before applying the import.
4. Confirm warnings that are acceptable for your organization.
5. Apply the import and review the resulting records.

## Clockodo Imports

If your organization imports from Clockodo, verify employee and project matching before applying the batch. Do not treat imported data as final until quality review is complete.
```

- [ ] **Step 3: Create implementation checklist guide**

Create `implementation-checklist.mdx` with this content:

```mdx
---
title: Implementation Checklist
description: Configure the core settings needed before rolling Z8 out to an organization.
---

# Implementation Checklist

Use this checklist when setting up a new organization or reviewing an incomplete rollout.

## Core Setup

- Add employees and confirm organization membership.
- Configure teams, locations, and manager assignments.
- Set work policies, work categories, holidays, and absence settings.
- Configure approval policies for requests that need review.
- Confirm payroll export and readiness requirements.

## Access And Security

- Review permissions and role assignments.
- Configure SSO, SCIM, social OAuth, or conditional access if your organization uses enterprise identity controls.
- Set app access rules for web, mobile, desktop, or browser extension access.

## Communication

- Configure notification channels and integration destinations.
- Review email templates if editable templates are enabled.
- Send onboarding instructions after core settings are ready.

## Validation

Before launch, create a small test group and walk through clocking time, requesting absence, approving a request, exporting reports, and reviewing notifications.
```

- [ ] **Step 4: Create work models guide**

Create `work-models.mdx` with this content:

```mdx
---
title: Work Models And Contracts
description: Manage employee work model and contract history for expected hours and compliance context.
---

# Work Models And Contracts

Work models describe how an employee is expected to work. Contract history keeps changes auditable over time instead of overwriting past assumptions.

## What To Track

- Weekly or monthly expected hours.
- Full-time, part-time, contractor, or other work model categories.
- Effective dates for contract changes.
- Overtime or payroll-relevant rules that depend on the work model.

## Why History Matters

Historical work model records help payroll, reporting, and compliance checks interpret past time entries correctly. Avoid replacing old values when a new contract starts; add a new effective period instead.

## Related Settings

Work models interact with work policies, holidays, payroll export, and employee management. Review those areas when contract expectations change.
```

- [ ] **Step 5: Update admin navigation**

Add new pages to `admin-guide/meta.json` in these sections:

```json
"---People---": "work-models" after "employee-management"
"---Configuration---": "approval-policies" after "change-policies"
"---Reports & Data---": "imports" before "project-reports"
"---Overview---": "implementation-checklist" after "index"
```

- [ ] **Step 6: Update admin landing page**

Add links to the four new admin pages in `admin-guide/index.mdx`. Keep descriptions one sentence each and group them with existing admin concepts.

---

### Task 6: Update Existing Admin Workflow Pages

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/employee-management.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/skills-qualifications.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/work-policies.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/holidays-and-vacation.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/analytics-and-exports.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/system-administration.mdx`

- [ ] **Step 1: Add work model cross-link**

In `employee-management.mdx`, add a short section:

```mdx
## Work Model Context

Employee records often connect to contract and work model history. Use [Work Models And Contracts](/docs/guide/admin-guide/work-models) when expected hours, contract type, or payroll-relevant work expectations change.
```

- [ ] **Step 2: Add qualification renewal context**

In `skills-qualifications.mdx`, add:

```mdx
## Renewal And Evidence Review

Use qualification tracking to monitor expiring certifications, review employee-submitted evidence, and keep role requirements current. Renewal dates should be reviewed before assigning work that requires a valid qualification.
```

- [ ] **Step 3: Add work policy cross-links**

In `work-policies.mdx`, add:

```mdx
## Related Configuration

Work policies often depend on [Work Models And Contracts](/docs/guide/admin-guide/work-models), holidays, and approval behavior. Review [Approval Policies](/docs/guide/admin-guide/approval-policies) when policy violations or changes should trigger manager review.
```

- [ ] **Step 4: Add absence planning admin context**

In `holidays-and-vacation.mdx`, add:

```mdx
## Employee Planning Context

Holiday calendars and vacation settings affect what employees see when planning absences. Clear holiday names and assigned calendars help employees understand whether a day counts against their balance before they submit a request.
```

- [ ] **Step 5: Review analytics claims**

In `analytics-and-exports.mdx`, search for Snowflake, BigQuery, and Data Warehousing claims. If the page describes routes or settings that are not present elsewhere in the docs or app, change the wording from setup instructions to capability overview language:

```mdx
Advanced warehousing destinations depend on the integrations enabled for your organization. If you do not see a data warehousing setting, use the standard exports available from analytics and payroll workflows.
```

- [ ] **Step 6: Add payroll readiness context**

In `payroll-export.mdx`, add:

```mdx
## Payroll Readiness

Before exporting payroll data, review readiness checks for blockers and warnings. Blockers should be fixed before export. Warnings may be acceptable when they reflect known business rules, but they should be reviewed before payroll is finalized.

Common readiness checks include missing time entries, unresolved approvals, unmatched employees, incomplete work model history, and policy exceptions.
```

- [ ] **Step 7: Align SCIM wizard wording**

In `scim-provisioning.mdx`, ensure the page says SCIM is configured through Enterprise Identity Setup and remains organization-scoped. Keep the warning that the SCIM bearer token is shown only once.

- [ ] **Step 8: Add notification channel context**

In `system-administration.mdx`, add:

```mdx
## Notification Channels

Organization notification settings control how operational messages are delivered. Depending on enabled integrations, channels can include in-app, email, push, Slack, Microsoft Teams, Telegram, Discord, or webhooks.

Review notification channels before rollout so employees and managers receive approval, reminder, and compliance-sensitive messages in the expected places.
```

---

### Task 7: Verify Images And Links

**Files:**
- Inspect: `apps/docs/content/docs/**/*.mdx`
- Inspect: `apps/docs/public/images/**/*`

- [ ] **Step 1: Verify stale links are gone**

Run: `rg '/docs/ui/' apps/docs/content/docs`

Expected: no matches.

- [ ] **Step 2: List image references**

Run: `rg '!\[[^\]]*\]\(/images/' apps/docs/content/docs`

Expected: all returned paths start with `/images/`.

- [ ] **Step 3: Check referenced image files manually**

For each image reference, confirm the corresponding file exists under `apps/docs/public/images`. Required files after this plan:

```text
apps/docs/public/images/user-guide/dashboard-page.png
apps/docs/public/images/user-guide/reports-page.png
apps/docs/public/images/user-guide/approvals-page.png
apps/docs/public/images/user-guide/time-tracking-page.png
apps/docs/public/images/user-guide/calendar-page.png
apps/docs/public/images/user-guide/absences-page.png
apps/docs/public/images/admin-guide/employees-page.png
apps/docs/public/images/admin-guide/locations-page.png
apps/docs/public/images/admin-guide/permissions-page.png
apps/docs/public/images/admin-guide/holidays-page.png
apps/docs/public/images/admin-guide/vacation-page.png
apps/docs/public/images/admin-guide/projects-page.png
apps/docs/public/images/admin-guide/surcharges-page.png
apps/docs/public/images/admin-guide/teams-page.png
```

- [ ] **Step 4: Do not add missing screenshot stand-ins**

If any planned image does not exist, remove that image reference from the MDX page and leave the prose intact.

---

### Task 8: Run Docs Verification

**Files:**
- Verify: `apps/docs`

- [ ] **Step 1: Run targeted docs build**

Run: `pnpm --filter docs build`

Expected: build succeeds without MDX, route, or metadata errors.

- [ ] **Step 2: If build fails due MDX syntax**

Fix the exact MDX file reported by the build. Common fixes are closing JSX tags, escaping angle brackets, and keeping Markdown image syntax outside JSX-only regions.

- [ ] **Step 3: If build requires unavailable env vars**

Do not create environment variables. Stop build verification and report that the build was skipped because agent-accessible Phase CLI variables are unavailable.

- [ ] **Step 4: Final search checks**

Run these commands:

```bash
rg '/docs/ui/' apps/docs/content/docs
rg 'TBA|coming soon|draft only' apps/docs/content/docs/guide
```

Expected: no stale `/docs/ui/` links. Any `TBA`, `coming soon`, or `draft only` match must be intentional existing content or removed from new content.

---

## Self-Review Notes

- Spec coverage: This plan covers stale links, new user pages, expanded manager docs, new admin workflow pages, existing page updates, screenshot reference rules, and build/link verification.
- Completion scan: The implementation steps avoid empty pages and define concrete MDX content for every new page.
- Scope control: Multi-entity organization management remains excluded from a full page until implementation visibility is confirmed, matching the spec's open decision.

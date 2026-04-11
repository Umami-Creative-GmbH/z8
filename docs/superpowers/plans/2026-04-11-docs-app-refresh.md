# Docs App Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `apps/docs` so the docs app accurately covers the most relevant user-, admin-, developer-, and operator-facing changes from the last 240 commits, with guide docs updated before technical docs.

**Architecture:** Keep the existing Fumadocs structure and update pages in place instead of redesigning the site. Derive each documentation change from current code and the most relevant recent commits, then validate the resulting MDX and navigation through a docs build.

**Tech Stack:** Next.js 16, Fumadocs, MDX, TypeScript, pnpm, Turborepo

---

## File Structure

### Guide navigation and landing pages

- Modify: `apps/docs/content/docs/guide/admin-guide/index.mdx`
  Purpose: Refresh the admin guide landing page so its cards and summary text reflect Workday, platform admin, enterprise auth, and current payroll/export capabilities.
- Modify: `apps/docs/content/docs/guide/manager-guide/index.mdx`
  Purpose: Refresh the manager landing page so approvals, team oversight, and settings references match current behavior and route structure.

### Guide feature pages

- Modify: `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`
  Purpose: Align payroll export docs with current file exports, API connectors, credential handling, and target-specific limitations.
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`
  Purpose: Explain platform admin versus org admin responsibilities and current route behavior.
- Modify: `apps/docs/content/docs/guide/admin-guide/app-access-control.mdx`
  Purpose: Document app access restrictions in terms of current admin workflows.
- Modify: `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`
  Purpose: Refresh SCIM onboarding and org-scoped provisioning guidance.
- Modify: `apps/docs/content/docs/guide/admin-guide/social-oauth.mdx`
  Purpose: Reflect current provider setup and enterprise auth expectations.
- Modify: `apps/docs/content/docs/guide/admin-guide/employee-management.mdx`
  Purpose: Cover invitations, members, and org-scoped people-management behavior without creating a new page.
- Modify: `apps/docs/content/docs/guide/admin-guide/manager-assignments.mdx`
  Purpose: Explain manager assignment behavior in language that matches current role-sensitive settings and approvals flows.
- Modify: `apps/docs/content/docs/guide/user-guide/time-tracking.mdx`
  Purpose: Update user-visible time-tracking behavior where canonical time and approval changes affect expectations.

### Technical pages

- Modify: `apps/docs/content/docs/tech/technical/index.mdx`
  Purpose: Update the architecture landing page so the stack and subsystem summaries match the repo today.
- Modify: `apps/docs/content/docs/tech/technical/authentication.mdx`
  Purpose: Refresh Better Auth, enterprise OAuth, secure cookie, invitation, and app access behavior.
- Modify: `apps/docs/content/docs/tech/technical/database.mdx`
  Purpose: Add canonical time model coverage and its relation to payroll export and approvals.
- Modify: `apps/docs/content/docs/tech/technical/features.mdx`
  Purpose: Update system-level feature docs for canonical time, payroll export, and approvals behavior.
- Modify: `apps/docs/content/docs/tech/technical/enterprise.mdx`
  Purpose: Refresh enterprise configuration topics including API keys, webhooks, social OAuth, and app access control.
- Modify: `apps/docs/content/docs/tech/technical/services.mdx`
  Purpose: Update service boundaries that matter to auth, approvals, notifications, and export orchestration.
- Modify: `apps/docs/content/docs/tech/deployment/index.mdx`
  Purpose: Replace stale Bun- and environment-related guidance with current pnpm-, worker-, and runtime-oriented deployment guidance where it belongs in the docs app.

### Verification target

- Verify: `apps/docs`
  Purpose: Confirm updated MDX, navigation, and route generation build cleanly.

---

### Task 1: Gather Commit Evidence And Lock The Content Map

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`
- Modify: `apps/docs/content/docs/guide/user-guide/time-tracking.mdx`
- Modify: `apps/docs/content/docs/tech/technical/authentication.mdx`
- Modify: `apps/docs/content/docs/tech/technical/features.mdx`
- Modify: `apps/docs/content/docs/tech/deployment/index.mdx`

- [ ] **Step 1: Read the most relevant recent commits for each doc theme**

Run:

```bash
git log --oneline -n 240
git show --stat 23bea68
git show --stat 6173fa1
git show --stat 7492d36
git show --stat ed1124c
git show --stat ce5190c
git show --stat a099f9f
git show --stat 339afba
git show --stat e3fd4ae
git show --stat 21c9204
git show --stat 08705a8
```

Expected: commit stats that confirm the refresh themes are payroll export, enterprise auth, invitation/member flows, canonical time, platform admin routing, settings-role behavior, and clock-in import.

- [ ] **Step 2: Read the current docs pages that directly map to those themes**

Run:

```bash
pnpm exec prettier --check \
  apps/docs/content/docs/guide/admin-guide/payroll-export.mdx \
  apps/docs/content/docs/guide/admin-guide/platform-admin.mdx \
  apps/docs/content/docs/guide/user-guide/time-tracking.mdx \
  apps/docs/content/docs/tech/technical/authentication.mdx \
  apps/docs/content/docs/tech/technical/features.mdx \
  apps/docs/content/docs/tech/deployment/index.mdx
```

Expected: either `All matched files use Prettier code style!` or a failure that simply confirms the files are present and parseable before editing.

- [ ] **Step 3: Replace stale claims with a fixed content map before touching prose**

Use this content map while editing the files above:

```md
- payroll-export.mdx
  - keep file-based export setup
  - keep Personio and SuccessFactors sections only if current code still supports them
  - make Workday limitations explicit
  - explain secure credential storage and connection testing

- platform-admin.mdx
  - explain `/platform-admin` as platform-scoped
  - distinguish platform admin from org settings admins
  - keep user/org suspension and audit topics only if still present

- time-tracking.mdx
  - preserve user workflow orientation
  - state which edits are immediate and which require approval
  - remove or soften claims that overstate immutable blockchain behavior if current code/docs no longer support that framing

- authentication.mdx
  - replace Bun-based setup commands with pnpm-compatible guidance
  - explain Better Auth, secure cookies, social OAuth, invitation onboarding, and app access control

- features.mdx
  - add canonical time-record model and approval pipeline coverage
  - update payroll export architecture summary

- deployment/index.mdx
  - replace Bun-specific commands with pnpm-based commands
  - keep only operator-relevant deployment guidance
```

- [ ] **Step 4: Commit the evidence-locking pass before content edits**

```bash
git add docs/superpowers/specs/2026-04-11-docs-app-refresh-design.md docs/superpowers/plans/2026-04-11-docs-app-refresh.md
git commit -m "docs: add docs app refresh spec and plan"
```

Expected: a commit containing only the design and implementation plan documents.

### Task 2: Refresh Guide Landing Pages And Admin-Facing Product Docs

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/index.mdx`
- Modify: `apps/docs/content/docs/guide/manager-guide/index.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/app-access-control.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/social-oauth.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/employee-management.mdx`
- Modify: `apps/docs/content/docs/guide/admin-guide/manager-assignments.mdx`

- [ ] **Step 1: Update the guide landing pages so they point readers at the right current capabilities**

Apply changes shaped like this:

```mdx
<Card
  title="Payroll Export"
  description="Export time and absence data to file-based payroll formats and supported API integrations including Workday validation flows"
  href="/docs/guide/admin-guide/payroll-export"
/>

<Card
  title="Platform Admin"
  description="Manage cross-organization users, organizations, and platform-level operations"
  href="/docs/guide/admin-guide/platform-admin"
/>
```

And fix stale manager-guide links so the help section uses current docs URLs:

```mdx
- [User Guide](/docs/guide/user-guide) - General employee features
- [Admin Guide](/docs/guide/admin-guide) - For administrators with additional permissions
```

- [ ] **Step 2: Rewrite the admin payroll export page around current capabilities instead of historical assumptions**

Make the page include sections shaped like this:

```mdx
## Overview

Z8 supports both file exports and selected API-based payroll integrations. The exact behavior depends on the target system.

## Supported Export Targets

- **DATEV, Lexware, Sage** for downloadable file exports
- **Personio** for API-based attendance and absence sync where configured
- **SAP SuccessFactors** for tenant-specific API export workflows where configured
- **Workday** for credential validation and configuration flows, with current export limitations documented below

## Workday Status

Workday support currently focuses on secure credential storage, tenant validation, and integration setup. If your organization is using the current v1 Workday path, verify whether the export run validates connectivity only or posts records before relying on it operationally.
```

Preserve useful target-specific setup instructions, but remove wording that implies every configured connector has identical export maturity.

- [ ] **Step 3: Rewrite the platform admin page so it clearly separates platform-scoped work from org-scoped settings**

Use content shaped like this:

```mdx
## Overview

Platform admin access is separate from organization administration. Organization admins manage a single workspace. Platform admins operate across all organizations through `/platform-admin`.

## What Platform Admins Can Do

- review platform-wide users
- inspect organizations across the tenant base
- suspend or restore organizations when required
- review platform audit history and queue health where available

## What Platform Admins Do Not Replace

Platform admin access does not replace normal organization settings workflows. Day-to-day payroll, scheduling, and member management remain organization-scoped tasks.
```

- [ ] **Step 4: Refresh enterprise admin pages with current setup language**

Use these content anchors:

```mdx
## App Access Control

Administrators can restrict whether a member may use the web app, desktop app, or mobile app. Restrictions are organization-scoped and should be documented as an access policy decision, not as a client-side preference.

## Social OAuth

Organization-specific social login lets an org configure branded sign-in with supported providers. Document redirect URI expectations and note that provider credentials are configured per organization in the product, not through tenant-specific environment variables.

## SCIM Provisioning

SCIM automates member lifecycle management from an identity provider into the current organization. Document the bearer token, endpoint, and org-scoped effects without implying cross-organization provisioning.
```

Use that wording to replace stale environment-heavy or under-scoped guidance.

- [ ] **Step 5: Fold invitation, membership, and manager-role behavior into existing people-management pages**

Update the people pages around these sections:

```mdx
## Members And Invitations

Use the organization people settings to invite members, review invitation state, and manage who has accepted access to the workspace.

## Manager Assignments

Manager assignments affect approvals and scoped oversight. Describe primary and secondary manager responsibilities in operational terms and avoid promising platform-wide permissions.
```

Do not create a new page unless the existing file becomes unreadable after these additions.

- [ ] **Step 6: Run the docs build after the guide-doc pass**

Run:

```bash
pnpm build:docs
```

Expected: the docs app completes a production build without MDX, routing, or navigation errors.

- [ ] **Step 7: Commit the guide-doc refresh**

```bash
git add \
  apps/docs/content/docs/guide/admin-guide/index.mdx \
  apps/docs/content/docs/guide/manager-guide/index.mdx \
  apps/docs/content/docs/guide/admin-guide/payroll-export.mdx \
  apps/docs/content/docs/guide/admin-guide/platform-admin.mdx \
  apps/docs/content/docs/guide/admin-guide/app-access-control.mdx \
  apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx \
  apps/docs/content/docs/guide/admin-guide/social-oauth.mdx \
  apps/docs/content/docs/guide/admin-guide/employee-management.mdx \
  apps/docs/content/docs/guide/admin-guide/manager-assignments.mdx
git commit -m "docs: refresh admin and manager guides"
```

Expected: a commit containing only the guide landing pages and admin-facing docs refresh.

### Task 3: Refresh User And Manager Workflow Docs

**Files:**
- Modify: `apps/docs/content/docs/guide/user-guide/time-tracking.mdx`
- Modify: `apps/docs/content/docs/guide/manager-guide/index.mdx`

- [ ] **Step 1: Update the user time-tracking page so approval behavior matches the current product model**

Use wording shaped like this:

```mdx
## Editing Time Entries

Whether a time change is applied immediately or sent for approval depends on your organization's change-policy rules.

- changes inside the self-service window may be applied directly
- older entries may require a correction request and manager review
- required reasons and available fields depend on your organization's configuration
```

Keep the page user-focused. Do not expose internal schema terminology like `canonical_time_record` in this guide page.

- [ ] **Step 2: Refresh the manager guide overview so approvals and oversight language stays accurate**

Use content shaped like this:

```mdx
## Manager Overview

Managers review team requests, monitor coverage, and work inside the scoped settings and analytics available to them in their organization.

## Handling Approvals

Approval queues can include absence requests and time-change requests. The exact items you see depend on your assignments and your organization's approval configuration.
```

Retain the calendar and analytics sections, but remove wording that suggests every manager has the same unrestricted settings access.

- [ ] **Step 3: Run the docs build after the workflow-doc pass**

Run:

```bash
pnpm build:docs
```

Expected: successful docs build with no MDX regressions.

- [ ] **Step 4: Commit the workflow-doc refresh**

```bash
git add \
  apps/docs/content/docs/guide/user-guide/time-tracking.mdx \
  apps/docs/content/docs/guide/manager-guide/index.mdx
git commit -m "docs: refresh time tracking and manager workflows"
```

Expected: a focused commit covering the user and manager workflow refresh.

### Task 4: Refresh Technical Architecture And Deployment Docs

**Files:**
- Modify: `apps/docs/content/docs/tech/technical/index.mdx`
- Modify: `apps/docs/content/docs/tech/technical/authentication.mdx`
- Modify: `apps/docs/content/docs/tech/technical/database.mdx`
- Modify: `apps/docs/content/docs/tech/technical/features.mdx`
- Modify: `apps/docs/content/docs/tech/technical/enterprise.mdx`
- Modify: `apps/docs/content/docs/tech/technical/services.mdx`
- Modify: `apps/docs/content/docs/tech/deployment/index.mdx`

- [ ] **Step 1: Refresh the technical landing page stack summary to match the repo today**

Replace stale stack notes with content shaped like this:

```mdx
### Tech Stack

- **Framework**: Next.js 16 for web and docs, Expo for mobile, Tauri for desktop
- **Language**: TypeScript, Rust for Tauri internals
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Better Auth with passkeys, 2FA, social OAuth, and enterprise extensions
- **Monorepo Tooling**: Turborepo and pnpm
```

Specifically remove or correct references that present Bun as the canonical package manager for this repo.

- [ ] **Step 2: Rewrite the authentication technical page around current Better Auth and organization-scoped behavior**

Use sections shaped like this:

```mdx
## Configuration

Z8 uses environment-backed system configuration for auth secrets and base URLs. Organization-specific OAuth settings are stored in the product for each organization rather than in tenant-specific environment variables.

## Session And Cookie Behavior

Document secure Better Auth session handling, active-organization context, and current callback behavior in terms of system design rather than one-off implementation details.

## Invitation And Onboarding Flows

Explain that invitation acceptance, callback redirects, and enterprise auth flows must preserve organization context and should be understood as part of the auth system, not as separate ad hoc routes.
```

Use pnpm-compatible commands where a command example is needed.

- [ ] **Step 3: Add canonical time and payroll-export architecture updates to the technical pages**

Apply content shaped like this:

```mdx
## Canonical Time Model

Recent time-tracking work centers on a canonical time-record model that normalizes work records, absence records, approval transitions, and downstream payroll/export processing.

## Payroll Export Architecture

Document the distinction between file formatters and API exporters, and note that exporter maturity differs by target system.
```

Use this structure in `features.mdx` and `database.mdx`, and update `services.mdx` to describe orchestration, background work, and notification boundaries in the same vocabulary.

- [ ] **Step 4: Refresh enterprise and deployment docs so they describe current operator expectations**

Use content shaped like this:

```mdx
## Enterprise Features

Enterprise features include API keys, webhooks, SCIM, social OAuth, and app access control. All org-specific credentials are configured in organization settings, while system secrets remain environment-backed.

## Deployment

Use pnpm-based build and workspace commands in examples. Keep deployment docs focused on runtime roles, migrations, workers, storage, and queue infrastructure rather than repo-internal CI history.
```

This step must also remove or replace Bun-specific examples such as `bun run build`, `bun run db:migrate`, and `bun run worker` where the repo standard is `pnpm`.

- [ ] **Step 5: Run the docs build after the technical-doc pass**

Run:

```bash
pnpm build:docs
```

Expected: a successful docs production build after the technical page refresh.

- [ ] **Step 6: Commit the technical-doc refresh**

```bash
git add \
  apps/docs/content/docs/tech/technical/index.mdx \
  apps/docs/content/docs/tech/technical/authentication.mdx \
  apps/docs/content/docs/tech/technical/database.mdx \
  apps/docs/content/docs/tech/technical/features.mdx \
  apps/docs/content/docs/tech/technical/enterprise.mdx \
  apps/docs/content/docs/tech/technical/services.mdx \
  apps/docs/content/docs/tech/deployment/index.mdx
git commit -m "docs: refresh technical and deployment docs"
```

Expected: a focused commit covering the technical docs refresh.

### Task 5: Final Verification And Delivery

**Files:**
- Verify: `apps/docs`

- [ ] **Step 1: Run the final docs verification build from the repo root**

Run:

```bash
pnpm build:docs
```

Expected: Turborepo reports a successful build for the `docs` package.

- [ ] **Step 2: Inspect the worktree to confirm only intended docs files changed**

Run:

```bash
git status --short
git diff -- apps/docs/content/docs docs/superpowers/specs docs/superpowers/plans
```

Expected: changes are limited to the planned docs content, plus the already-approved spec and plan files.

- [ ] **Step 3: Prepare the delivery summary with commit-theme coverage**

Use this structure in the final handoff:

```md
- Updated guide docs for payroll export, platform admin, enterprise auth, people management, and manager workflows
- Updated technical docs for Better Auth, canonical time architecture, payroll export architecture, services, and deployment guidance
- Verified the docs app with `pnpm build:docs`
```

- [ ] **Step 4: Create the final verification commit**

```bash
git add apps/docs/content/docs
git commit -m "docs: verify refreshed docs app content"
```

Expected: a final commit only if verification produced additional staged changes. If no files changed after Step 2, skip this commit and report that no final verification-only commit was necessary.

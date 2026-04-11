# Docs App Refresh Design

## Summary

Refresh the `apps/docs` documentation app so it accurately covers the most relevant product and technical changes from the last 240 commits, with priority on user-, manager-, and admin-facing features before developer and operator documentation.

## Context

- The docs app already has stable guide and technical sections under `apps/docs/content/docs/guide` and `apps/docs/content/docs/tech`.
- The last 240 commits contain substantial changes in a few recurring areas rather than one-off isolated features.
- The most docs-relevant themes in that window are:
  - auth and enterprise access hardening
  - payroll export expansion, including Workday support and connector behavior
  - canonical time-record model work and approval flow changes
  - platform-admin versus org-admin routing and responsibilities
  - invitations, members, and settings-role behavior
  - selected deployment and runtime changes for operators
- The current docs app already contains pages for several of these topics, but some pages lag behind shipped behavior and some newer capabilities are only partially represented.
- The existing Fumadocs structure is sufficient for this refresh; the gap is mainly content accuracy and discoverability, not framework capability.

## Goals

- Update the docs app to reflect the major shipped changes from the last 240 commits that matter to product users, admins, managers, developers, and operators.
- Prioritize guide docs before technical docs.
- Keep the existing navigation model unless a small additive change is necessary.
- Make current feature limitations explicit where behavior is intentionally partial.
- Ensure the docs app still builds successfully after the content changes.

## Non-Goals

- No redesign of the docs app UI or information architecture.
- No release-notes or changelog system.
- No commit-by-commit historical narrative inside the docs.
- No broad rewrite of unrelated pages for style consistency alone.
- No documentation of internal-only changes that do not affect users, admins, developers, or operators.

## Approved Direction

Use a targeted documentation refresh inside the existing `guide` and `tech` trees.

The refresh should be evidence-based:

- derive topic coverage from the last 240 commits
- verify each topic against current code and existing docs pages
- update existing pages in place when possible
- add a new page only when the current page would become too broad or unclear

Guide docs are the first priority. Technical docs come second once user/admin-facing behavior is accurately represented.

## Information Sources

### Commit review strategy

Do not treat all 240 commits as equally important to the docs refresh.

Instead, group them into documentation themes and read the most relevant commits and diffs inside each theme:

- auth and enterprise access
- payroll export and connectors
- canonical time-record model and approvals
- platform-admin and org-admin routing
- invitations, members, and settings role behavior
- deployment and runtime changes suitable for operator documentation

Low-signal commits such as dependency bumps, merge commits, lockfile churn, and purely internal cleanup should not drive new documentation unless they materially change documented behavior.

### Source-of-truth rule

For any page update, the source of truth is:

1. current code and route behavior
2. recent implementation commits and diffs that introduced the behavior
3. existing docs pages, only as the baseline to correct or extend

If a recent commit suggests a feature direction but the current codebase does not clearly expose that behavior, document only what is clearly shipped now.

## Scope

### Guide docs to update

Update these existing pages in place unless review shows a page is too overloaded:

- `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`
- `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`
- `apps/docs/content/docs/guide/admin-guide/app-access-control.mdx`
- `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`
- `apps/docs/content/docs/guide/admin-guide/social-oauth.mdx`
- `apps/docs/content/docs/guide/admin-guide/employee-management.mdx`
- `apps/docs/content/docs/guide/admin-guide/manager-assignments.mdx`
- `apps/docs/content/docs/guide/user-guide/time-tracking.mdx`
- `apps/docs/content/docs/guide/manager-guide/index.mdx`
- any directly related manager-guide subpages whose claims conflict with current approvals or oversight behavior

### Guide docs that may be added

Only add a new guide page if the current content cannot absorb the topic cleanly.

Primary candidates:

- `apps/docs/content/docs/guide/admin-guide/members-and-invitations.mdx`
- `apps/docs/content/docs/guide/admin-guide/clockin-import.mdx`

Add these only if the current admin guide pages cannot document the feature clearly without becoming diffuse.

### Technical docs to update

Update these technical pages to match current architecture and implementation boundaries:

- `apps/docs/content/docs/tech/technical/features.mdx`
- `apps/docs/content/docs/tech/technical/database.mdx`
- `apps/docs/content/docs/tech/technical/authentication.mdx`
- `apps/docs/content/docs/tech/technical/enterprise.mdx`
- `apps/docs/content/docs/tech/technical/services.mdx`
- `apps/docs/content/docs/tech/deployment/index.mdx` when runtime or operator-facing behavior changed materially

### Technical docs that may be added

Only add these pages if current pages cannot express the topic clearly without overloading them:

- `apps/docs/content/docs/tech/technical/canonical-time-model.mdx`
- `apps/docs/content/docs/tech/technical/platform-admin-routing.mdx`

## Content Model

### Guide docs

Guide docs should stay task-oriented and role-oriented.

Each updated guide page should answer:

- what this feature is for
- who can use or configure it
- where it lives in the product
- what changed materially in current behavior
- what limitations or rollout caveats still exist

Guide docs should avoid deep internal implementation details unless they change user or admin expectations.

### Technical docs

Technical docs should stay architecture-oriented.

Each updated technical page should explain:

- the system boundary or subsystem purpose
- important data model or routing decisions
- how newer behavior differs from the older mental model when relevant
- any partial implementations or safe placeholder paths that engineers and operators must understand

Technical docs should not repeat step-by-step admin guidance that already belongs in the guide pages.

## Topic-Specific Direction

### Payroll export

Document current payroll export support with clear separation between:

- file-based exports
- API-based connectors
- credential validation and storage behavior
- per-target capability differences

Workday coverage must explicitly describe current state, including any safe placeholder or validation-only behavior, so admins and developers do not assume records are posted when only connectivity is verified.

Where relevant, describe SuccessFactors and other export targets only at the level supported by the current product and code.

### Platform admin versus org admin

Document the route split and role expectations clearly.

The docs should distinguish:

- organization-scoped administration inside org settings
- platform-scoped administration inside platform admin routes
- any operational restrictions or prerequisites for platform-admin access

This should remove ambiguity for admins who previously expected a single admin surface.

### Invitations, members, and settings-role behavior

Document current member and invitation lifecycle behavior in admin-facing docs where it affects day-to-day organization administration.

Role-sensitive settings access should be described in terms of what users can do, not internal helper names.

If manager-scoped versus org-admin-scoped actions are materially different, the docs should state that directly.

### Auth and enterprise access

Refresh docs for:

- social OAuth setup and current behavior
- SCIM provisioning expectations and org scope
- API keys and app access control where recent auth changes affect configuration
- invitation onboarding or callback behavior if it changed user-facing expectations

Do not over-document internal secret resolution details unless they affect deployment or operator setup.

### Canonical time-record model and approvals

Guide docs should only mention canonical time behavior where users, managers, or admins experience changed outcomes.

Technical docs should explain the newer canonical model, related schema concepts, approval flow implications, and payroll-export interaction at a system level.

Avoid copying internal table definitions blindly into user-facing docs.

### Deployment and runtime behavior

Only operator-relevant deployment changes belong in `apps/docs` technical deployment docs.

Examples that may qualify:

- runtime image or deployment behavior that affects how self-hosters operate the system
- production environment expectations that changed materially
- migration or worker/runtime responsibilities that operators must understand

Pure CI optimization or repository-internal workflow cleanup should stay out of the docs app.

## Navigation and Structure

Keep the existing Fumadocs structure.

Allowed navigation changes:

- add a new page to the relevant `meta.json` when a new page is introduced
- adjust ordering inside an existing section if it improves discovery of newly important pages

Disallowed structural changes in this scope:

- renaming top-level doc trees
- moving the docs app to a different framework or layout
- reworking the homepage into a new information architecture

## Editing Strategy

### 1. Reconcile current claims

For each target page:

- read the current page
- identify claims that may be outdated based on recent commit themes
- confirm the current shipped behavior in code or strongly relevant implementation diffs
- replace stale claims with current capability descriptions

### 2. Prefer in-place updates

If a page can absorb the new information cleanly, update it in place rather than creating a sibling page.

Create a new page only when one of these is true:

- the existing page would become too broad for one clear reader task
- the new topic has distinct navigation value
- mixing the topic into an existing page would make either page harder to scan

### 3. Keep claims durable

Write documentation around stable behavior rather than around the names of individual commits.

Good examples:

- what an admin can configure now
- how data flows through the current architecture
- what is validated versus what is fully executed

Bad examples:

- commit summary style prose
- implementation details that can churn without changing external behavior

## Error Handling and Documentation Risks

- If a feature appears partially shipped, document the verified current behavior and its limitation explicitly.
- If a topic is implemented in code but not discoverable in the UI yet, keep it out of user-facing docs unless there is a valid admin or operator path today.
- If a recent commit contradicts the current code, the current code wins.
- If a change belongs only in repository contributor docs rather than product or operator docs, do not add it to `apps/docs`.

## Verification Strategy

Verification should cover both content accuracy and docs app integrity.

### Accuracy checks

- every updated page must be supported by current code or recent implementation evidence
- limitations and partial behaviors must be stated explicitly where relevant
- guide docs and technical docs must not contradict each other on current capability

### Structural checks

- any new pages are included in the correct `meta.json`
- existing internal links still resolve to valid docs routes
- titles and descriptions stay aligned with page content

### Build checks

- run the docs app build with `pnpm` so MDX, navigation, and route generation issues surface before completion

## Success Criteria

- The docs app reflects the most relevant shipped changes from the last 240 commits.
- User-, manager-, and admin-facing documentation is refreshed before technical documentation.
- Payroll export, enterprise auth, canonical time architecture, platform admin routing, and member/invitation behavior are accurately represented where applicable.
- New pages are added only when they improve clarity and discoverability.
- The docs app builds successfully after the changes.

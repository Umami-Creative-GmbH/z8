---
status: accepted
---

# Settings pages and navigation use settings access and server-computed capabilities

[ADR 0002](./0002-settings-actions-authorize-by-settings-access-not-casl.md) moved settings server actions onto one **Settings access** model (`member`, `scopedManager`, `orgAdmin`, `owner`, or `null`), while settings pages, the settings sidebar, the app sidebar, and app search stayed on the older three-level `SettingsAccessTier` (`member`, `manager`, `orgAdmin`). Keeping both models caused edge-case drift for former employees and unapproved memberships and hid settings routes that custom roles or project-level grants allow (`closed-months`, `approval-policies`). We decided to retire `SettingsAccessTier` completely and govern every settings page, navigation surface, and search entry by **Settings access** (`SettingsAccess | null`, where `null` marks account-only surfaces that belong to no organization) paired with a single server-computed `settingsCapabilities` bag for non-tier grants.

## Considered Options

- **Keep `SettingsAccessTier` for navigation and `SettingsAccess` for actions.** Rejected: the two models disagree on former employees and unapproved memberships, force mixed resolution inside the same page (such as `settings/employees`), and obscure the `owner` vs `orgAdmin` distinction.
- **Evaluate CASL abilities in client navigation components.** Rejected: client components should not reconstruct or carry authorization rules; server-computed booleans keep navigation presentation-only while real authorization stays in server guards and `organizationAction` handlers.
- **Add feature-specific levels to `SettingsAccess`.** Rejected: grants such as closing months, managing approval escalations, managing a single project, or viewing driving licence settings are orthogonal to the four-level organization hierarchy, not an ordered ladder.

## Consequences

- `SettingsAccess` (`member | scopedManager | orgAdmin | owner | null`) is the single settings access vocabulary across server actions, page guards, settings navigation, app sidebar, and app search. `SettingsAccessTier` and `ORG_ADMIN_SETTINGS_ROUTES` are retired.
- Account-only routes (`profile`, `security`, `notifications`, `wellness`) declare `minimumAccess: null` so signed-in users without active organization settings access (including former employees and pending members) keep access to their own account. Organization-scoped self-service routes (`position-stamps`, `my-data`) require `"member"`.
- Non-tier visibility exceptions (`canAccessClosedMonths`, `canManageApprovalEscalation`, `canManageProjects`, `canManageDrivingLicence`, `hasActiveReportShareLinks`) are computed once on the server per request and passed as a typed `settingsCapabilities` object into navigation and search filters rather than accumulating ad-hoc boolean parameters.
- Navigation visibility remains presentation-only: every canonical settings route enforces its own server page guard (including feature-flag `notFound()` checks where applicable) and every mutation authorizes inside `organizationAction`.

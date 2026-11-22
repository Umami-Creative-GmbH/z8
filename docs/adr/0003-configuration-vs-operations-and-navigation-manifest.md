---
status: accepted
---

# Configuration vs. Operations boundary and single navigation manifest

Recurring operational workflows (payroll readiness checks, payroll export execution, month closing, billable hand-off, and organization health statistics) accumulated under `/settings` alongside one-time setup, while webapp navigation drifted across four independent registries (sidebar, Cmd+K static search, Cmd+K icon map, and route metadata). We decided that `/settings` owns configuration, policies, master-data setup, and rare admin maintenance, whereas recurring business operations live in top-level workspaces; and that a single typed navigation manifest serves as the sole source of truth for sidebar sections, Cmd+K page discovery/icons, and route metadata.

## Considered Options

- **Keep operational pages in `/settings` and add cross-links.** Rejected: `/settings` already had 87 page routes across 11 groups, duplicated top-level `/payroll`, and hid daily work behind an admin configuration hub.
- **Extract every non-policy page from `/settings` (including Employees, Work Diagnostics, and Export Operations).** Rejected: moving rare admin maintenance and org-admin setup tools out of `/settings` would bloat the primary sidebar and churn [ADR 0002](0002-settings-actions-authorize-by-settings-access-not-casl.md) settings-access boundaries without improving daily workflows.
- **Continue maintaining sidebar, Cmd+K, and route metadata separately with lint/test guards.** Rejected: four disconnected lists already produced 14+ missing Cmd+K routes, orphaned icon entries, and conflicting titles; unifying the data model prevents drift by construction.

## Consequences

- Top-level sidebar navigation has four bounded sections: **Workplace** (personal self-service + Org Explorer), **Team** (manager/planner oversight + Today + Analytics), **Organization** (officer and org-wide operational consoles, hidden when empty), and a utility-only **Settings & help** footer.
- All personal/staff feature pairs follow one split-pair rule (`Workplace` for self-service, `Organization` for staff/officer consoles), with `/scheduling` remaining the single combined-route exception.
- Top-level operational workspaces that absorb `/settings` workflows (`/payroll`, `/analytics`, `/billable-time/hand-off`) must preserve existing access boundaries from [ADR 0002](0002-settings-actions-authorize-by-settings-access-not-casl.md) — specifically org admins without an employee record and custom-role holders (such as close-month permissions) — while retaining scoped grants for delegated officers.
- Every relocated route keeps a locale-preserving redirect from its legacy `/settings/*` URL so bookmarks, deep links, and notifications continue to work.
- Any new top-level app route is added once to the navigation manifest, which derives sidebar placement, Cmd+K indexing/icons, and shell route metadata together.

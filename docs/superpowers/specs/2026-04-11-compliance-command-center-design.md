# Compliance Command Center Design

## Summary

Add a new top-level `Compliance` area for organization admins that gives a calm, risk-first overview across audit evidence, workforce policy compliance, and sensitive control changes. V1 is intentionally overview-only: it summarizes existing signals, highlights the most important issues, and links users to existing destination pages for investigation or action.

## Context

- The current product already has org-admin audit surfaces such as `Audit Log` and `Audit Export`.
- There is also adjacent compliance-related product work and design history for audit packs and workforce compliance warnings.
- Those capabilities exist in separate places, which makes it harder for an org admin to answer a simple daily question: where are the current compliance risks?
- The product is a multi-tenant workforce-management SaaS, so any compliance surface must remain organization-scoped, role-aware, and explicit about what it does and does not monitor.
- V1 should improve visibility first, not invent a parallel remediation workflow before the signal sources are unified enough to support one.

## Goals

- Give org admins one top-level place to scan current compliance risk.
- Prioritize risk visibility over deep reporting or remediation workflows.
- Reuse existing signals and existing action destinations wherever possible.
- Combine a balanced starter set of signals from audit and evidence, workforce policy compliance, and access or security controls.
- Make critical states feel fresher than slower trend summaries.
- Avoid false confidence by distinguishing healthy, unavailable, and partially covered states.

## Non-Goals

- No direct remediation, assignment, acknowledgment, or resolution workflow inside the command center.
- No new compliance scoring engine or standalone workflow platform in v1.
- No replacement of `Audit Log`, `Audit Export`, or other existing source pages.
- No attempt to claim full compliance coverage across all subsystems in v1.
- No new cross-tenant or cross-organization views.

## Approved Direction

Build a new top-level org-admin-only `Compliance` route that presents a read-only command-center page backed by a small server-side aggregation layer. The page summarizes existing signals into a consistent dashboard contract, highlights the most important current issues, and routes users into existing product destinations when they need to investigate further.

This is not a settings-page expansion and not an embedded `Audit Export` variant. It should feel like a first-class operational overview surface for org admins, while still reusing the existing audit and compliance systems behind the scenes.

## Approaches Considered

### A) Dedicated read-only command center with server-composed sections (selected)

Create a top-level `Compliance` area with one server-composed loader that aggregates existing signals into overview cards and a recent critical events feed.

Pros:

- Matches the desired top-level information architecture.
- Delivers value quickly without forcing a new workflow engine.
- Keeps action ownership in existing pages.
- Creates a clean foundation for future drill-down or triage work.

Cons:

- Some signal families may be shallow at first.
- Needs deliberate normalization so the page does not become a loose collection of unrelated queries.

### B) Unified normalized risk-feed first

Build a backend layer that first models all source signals as a shared persisted risk-finding system, then render the page entirely from that feed.

Pros:

- Stronger long-term platform for triage and workflow features.
- Easier to sort, severity-rank, and extend consistently.

Cons:

- More backend and data-model work before users get value.
- Higher scope than needed for an overview-only v1.

### C) Thin UI shell over existing components

Assemble the page quickly by reusing current cards, tables, and source queries with minimal aggregation.

Pros:

- Fastest to build.
- Lowest up-front architecture cost.

Cons:

- Likely to feel stitched together.
- Harder to keep severity and status semantics consistent.
- Weak foundation for later evolution.

## Architecture

V1 should introduce a dedicated top-level route, tentatively `/compliance`, guarded for organization admins only.

The page should depend on a single server-facing loader, tentatively `getComplianceCommandCenterData(organizationId)`, which gathers section summaries in parallel and returns a normalized dashboard payload.

Recommended structure:

- route page component for the `Compliance` area
- one page-level server loader
- a small set of focused section builders behind that loader
- shared normalization into a dashboard card contract

Tentative builder responsibilities:

- `buildAuditEvidenceSection`
- `buildWorkforceComplianceSection`
- `buildAccessControlSection`
- `buildRecentCriticalEvents`

The page itself should stay presentation-focused. Section builders remain the place where existing source data is translated into dashboard semantics.

This preserves clear boundaries:

- existing systems remain the source of truth
- the command center only summarizes and prioritizes
- future drill-downs can extend the aggregation layer without replacing the route contract

## Information Architecture

The command center should be a top-level app destination rather than a settings child page.

Why:

- the user chose a first-class app area rather than a settings expansion
- the page is meant for ongoing operational visibility, not configuration
- this avoids overloading `Audit Export` with responsibilities that exceed export setup and artifact management

Navigation contract:

- visible only to org admins
- hidden from managers and members in v1
- direct URL access uses the existing org-admin denial path or equivalent route guard behavior

The top-level entry label should be `Compliance` unless another app-navigation naming convention requires a longer label such as `Compliance Center`.

## Components

The page should optimize for fast scanning and clear prioritization, not dense reporting.

Recommended v1 sections:

### 1. Risk summary header

A compact summary row that communicates overall state, highest active risk areas, and refresh context.

This should use a simple section-severity rollup rather than a new opaque compliance score. The summary should answer:

- are there critical issues right now?
- which area is driving the highest risk?
- when was this view last refreshed?

### 2. Priority cards

Three primary cards, one per signal family:

- audit and evidence
- workforce policy compliance
- access and security controls

Each card should include:

- section status
- a short headline
- 2 to 4 supporting facts
- `updatedAt`
- one primary link to the source destination page

### 3. Recent critical events

A short cross-source list of the most important recent issues. This is the place for events such as:

- failed audit-pack generation
- failed audit-package verification
- missing signing readiness
- serious workforce warning spikes where existing source data supports them
- sensitive admin-control changes or suspicious churn where existing source data supports them

This list is intentionally short and severity-filtered.

### 4. Freshness and coverage footer

A small transparency section that explains:

- what is actively monitored in v1
- what data may refresh more slowly
- what is not yet covered

This avoids implying complete compliance coverage before the product actually has it.

## Shared Card Contract

Each primary section should normalize into a consistent shape so the page stays simple even when source systems differ.

Recommended contract:

```ts
type ComplianceSectionStatus = "healthy" | "warning" | "critical" | "unavailable";

type ComplianceSectionCard = {
	key: "auditEvidence" | "workforceCompliance" | "accessControls";
	status: ComplianceSectionStatus;
	headline: string;
	facts: string[];
	updatedAt: string | null;
	primaryLink: {
		label: string;
		href: string;
	};
};
```

Notes:

- `healthy` means the monitored source returned no active issues for the checks that are wired.
- `unavailable` means the dashboard could not determine the state.
- Partial coverage should be conveyed explicitly through facts or explanatory copy, not hidden behind a green-looking success state.

## Initial Signal Sources

V1 should reuse existing or already-planned-near-term sources instead of inventing new scoring logic.

### Audit and evidence

Primary source family:

- `Audit Export` configuration and readiness
- audit pack request and job status
- audit package verification or signing-readiness signals where already available

Likely destination links:

- `/settings/audit-export`
- any existing audit-package or verification destination already present in the product

Example facts:

- signing setup complete or incomplete
- recent failed audit-pack jobs
- recent verification failures
- most recent successful package generation

### Workforce policy compliance

Primary source family:

- existing workforce-compliance warning systems or near-term planned warning outputs
- scheduling-related compliance summaries where they already exist in queryable form

Likely destination links:

- existing scheduling or compliance-warning destinations

Example facts:

- active warning count
- highest-risk category such as rest time, max hours, or overtime
- recent exception trend if already available

If workforce signals are not yet sufficiently queryable in the current codebase at implementation time, the section should ship as clearly partial or unavailable instead of synthesizing unsupported conclusions.

### Access and security controls

Primary source family:

- central audit log
- sensitive control-change events already captured in org-scoped audit data

Likely destination links:

- `/settings/enterprise/audit-log`

Example facts:

- recent admin-role changes
- API key or webhook-related changes where those actions are already logged
- unusual concentration of permission or control churn in a recent window

This section should remain tied to actual captured audit events, not aspirational security analytics.

## Data Flow

Recommended request flow:

1. Route guard verifies org-admin access and resolves active `organizationId`.
2. The page calls `getComplianceCommandCenterData(organizationId)`.
3. Section builders load their source data in parallel.
4. Each builder normalizes its result into the shared card contract.
5. The loader derives the recent critical events list from the section outputs and source details.
6. The page renders the normalized payload.

This loader should return one payload so the UI does not coordinate multiple independent fetch contracts on first render.

## Freshness Model

V1 uses mixed freshness.

Higher-freshness states:

- active failed audit-pack jobs
- missing signing readiness
- recent verification failures
- recent sensitive admin-control changes
- any other clearly critical source states already supported by existing systems

Lower-freshness states:

- rolling counts
- summary trends
- slower workforce warning aggregates

Implementation direction:

- critical states may auto-refresh periodically or be fetched with shorter staleness windows
- slower summaries can refresh on page load only

The UI should surface enough timing context that users can tell whether they are looking at a fresh operational state or a slower summary.

## Error Handling

The route should fail softly at the section level.

Rules:

- one failing source must not collapse the full page
- a failing section renders `unavailable` with brief explanatory copy
- unavailable must never be styled or phrased like healthy
- stale data should be labeled stale once it exceeds the expected freshness for that section
- an empty section may only render as healthy when the underlying source successfully reports no active issues
- if the source is missing, unconfigured, or not yet implemented, the card must say so explicitly

Authorization behavior:

- org admins may load the route
- non-admins do not see the nav item and are denied on direct access

## Security and Multi-Tenancy

All command-center data must remain scoped to the active organization.

Rules:

- every section builder requires `organizationId`
- no cross-org aggregation or shared admin views
- all source queries reuse existing org-scoped query patterns
- access control matches current org-admin-only audit surfaces in v1

The command center should not bypass existing page-level protections in downstream destinations. It only links to those destinations.

## Testing Strategy

Recommended coverage:

- loader tests for org-admin authorization and `organizationId` scoping
- builder tests for `healthy`, `warning`, `critical`, and `unavailable` states
- builder tests proving missing or failed source data does not collapse to false healthy
- page tests proving expected cards, facts, and links render from normalized payloads
- route or nav tests proving the top-level entry is org-admin-only
- regression tests proving existing destination pages such as `Audit Log` and `Audit Export` are unchanged by the command-center addition

`Recent critical events` should remain a derived view in v1. It does not need new persistence.

## Rollout Notes

- Ship behind a feature flag if the team wants to stage the route before broad org-admin rollout.
- Prefer launching with transparent partial coverage over inventing unsupported risk conclusions.
- Add signal sources incrementally behind the same normalized contract rather than broadening the UI shape early.

## Future Expansion

Possible next steps after v1 proves useful:

- richer drill-down panels
- normalized risk-feed infrastructure if overview data becomes too fragmented
- triage workflows such as acknowledge, assign, or resolve
- broader coverage reporting and historical trend views

These are intentionally deferred so v1 stays focused on risk visibility.

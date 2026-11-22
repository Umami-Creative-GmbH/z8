---
status: accepted
---

# Compliance exceptions join the Approval Inbox through a dedicated inbox adapter

ArbZG compliance exceptions (rest-period and overtime waivers) lived in a standalone queue at `/settings/compliance` that rendered no settings, was hidden from Settings navigation, and was reachable only from the orgAdmin-only `/compliance` page, notifications, and Teams cards — cutting managers out of a queue they were authorized to decide. We decided to integrate `compliance_exception` into the unified **Approval inbox** through a dedicated inbox adapter backed directly by `compliance_exception` rows, and redirect `/settings/compliance` to `/approvals/inbox?types=compliance_exception`.

The adapter preserves existing ArbZG domain rules without waiting for a full canonical workflow migration: users with `manage Compliance` see all organization exceptions, managers see exceptions for their managed employees, self-decision is always refused, bulk-approve and fast-lane auto-grouping are disabled so each statutory waiver gets deliberate review, covering deputies do not decide compliance exceptions, and rejecting from the inbox requires a non-empty reason.

## Considered Options

- **Keep `/settings/compliance` as a standalone queue and add navigation links.** Rejected: leaves managers juggling two disconnected approval queues with different rejection UX, no shared dashboard/briefing counts, and no unified inbox filtering.
- **Migrate `compliance_exception` onto canonical `approval_workflow` first.** Rejected: requires a multi-stage lifecycle rollout, workflow routing rules, and backfill migrations before managers can see compliance exceptions in the inbox; the adapter delivers unification immediately while keeping `compliance_exception` ready for a future canonical cutover.

## Consequences

- `compliance_exception` participates in Approval Inbox listing, counts, filtering (`?types=compliance_exception`), detail review, single-item approve/reject, Approval Sprint, the Dashboard Pending Approvals widget, and the Manager Daily Briefing without writing `approval_request` rows.
- Every inbox decision seam (`GET /api/approvals/inbox/[id]`, `POST .../approve`, `POST .../reject`) must dispatch `compliance_exception` targets through the adapter's authorization and transition rules rather than assuming every target is an `approval_request` or `approval_stage_assignment`.
- `DEPUTY_DECISION_ENTITY_TYPES` remains limited to absences, time approvals, and expense reports; covering deputies never act on ArbZG compliance exceptions.

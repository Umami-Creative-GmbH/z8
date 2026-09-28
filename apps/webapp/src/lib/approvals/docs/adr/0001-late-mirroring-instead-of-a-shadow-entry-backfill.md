---
status: accepted
---

# Legacy requests from before shadow mirroring are late-mirrored when first acted on, not backfilled on entry

Moving a kind from `legacy` to `shadow` creates no canonical workflows for legacy requests that are already pending. Deciding or transferring such a request under shadow mirroring used to depend on the kind: work periods mirrored a synthetic submission first, time corrections refused the decision, and absences failed inside the observation planner. We decided that the legacy write coordinator late-mirrors every kind the same way (#475). When shadow mirroring finds no observed workflow for the legacy request being acted on, it first mirrors that request as a fresh submission, then mirrors the action onto the new workflow.

## Considered Options

- **Refuse, and require in-flight legacy requests to drain before `shadow`.** Rejected: an organization cannot freeze approvals for a rollout step, and work periods already relied on late mirroring.
- **Backfill every pending legacy request on the `legacy` to `shadow` transition.** Rejected: a batch write inside the cutover transition, under the exclusive rollout lock, for requests that may never be acted on again. The `shadow` to `ready` reconciliation already records its own backfill.
- **Keep per-kind behaviour, with late mirroring opt-in.** Rejected: it leaves absences broken and every new caller choosing again.

## Consequences

- Late-mirrored workflows stay after rollback of the calling code; undoing the decision means cleaning those workflows up, not just reverting.
- A late-mirrored workflow takes its submission time from the legacy record, so it reads as submitted when the legacy request was.

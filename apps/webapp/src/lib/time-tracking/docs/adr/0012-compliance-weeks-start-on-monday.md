---
status: accepted
---

# Compliance weeks start on Monday independently of display and submission weeks

Recorded-work compliance used Sunday weeks while Scheduling used Monday weeks, so the same work could fall into different weekly groups. We decided that both use a **compliance week** from local Monday midnight up to the following Monday midnight (#994). Each path keeps its existing timezone and aggregation rules: the compliance check assigns a whole work period to the week in which it started, while Scheduling plans on the organization's calendar.

## Considered Options

- **Use the personal week-start preference.** Rejected: changing a display preference must not change the weekly rules applied to an employee's work.
- **Use the organization's submission cadence.** Rejected: submission periods collect confirmations and approvals; an organization may use a monthly cadence or collect no submissions, and changing it must not change compliance findings.
- **Add a configurable compliance week to organizations or work policies.** Not needed for this fix: Monday matches Scheduling's existing definition without adding another configurable boundary.

## Consequences

- Every newly performed compliance check uses Monday weeks, even when checking older work after a delay. The work's start selects its week, not the time the check runs.
- Existing recorded violations remain evidence under ADR-0003. Changing the week definition neither rewrites them nor triggers a historical re-evaluation or backfill.
- Calendar display and submission periods retain their own week-start settings. Their boundaries may differ from a compliance week.

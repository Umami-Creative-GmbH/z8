---
status: accepted
---

# Completed work is written only through work records, and every completed work period has a canonical work record in agreement with it

A completed work period is kept twice: the work period with its time entries, and its canonical work record, which payroll reads. Until now every writer kept both itself. Five of them divided work periods, each with its own copy of the record agreement check, and those copies drifted apart: the legacy split never divided the canonical work record (#1205), the legacy automatic break left it untouched and gave the new half none, and the terminal break never compared the project allocation. We decided that one module, **work records**, is the only writer of completed work in both admissions. It creates, divides, amends (times, work attribution, approval state) and deletes completed work inside a work transaction, checks record agreement with one rule, and applies the effects that follow any change to work: carrying invoiced work, sending period submissions back and marking the work balance dirty.

## Decisions

- Callers state policy (where to divide, the gap, an attribution override). Work records works out what each half carries.
- Every write is compare-and-set against the pair's revision, which work records advances in both admissions.
- Records that disagree come back as a `canonical_divergence` outcome. Each caller decides whether to refuse the change or defer it.
- Every completed work period has a canonical work record. A database check enforces this for new and changed rows (`NOT VALID`, so old data is not re-checked).
- Completed work in a closed month that still lacks its canonical work record keeps lacking it, because nothing may change it (ADR 0004). When the month is reopened, work records attaches the missing record.
- The approval write-boundary scanner refuses any other writer of the canonical tables. For `work_period` and `time_entry`, it allows only Clocking's live-work functions besides work records. Live work stays with Clocking (ADR 0002) and is handed over at clock-out.

## Considered Options

- **Each writer keeps both records itself, with a shared agreement helper.** Rejected: that is the arrangement that drifted. A helper can be left out, called with too few fields, or copied into the app layer, as happened with the legacy split.
- **Give the backfill a sanctioned exemption from closed months.** Rejected: ADR 0004 promises no session flag can unlock a closed month. Half pairs in a closed month cannot diverge further, because nothing may write them.
- **Move live work into work records too.** Rejected: live work has no canonical work record to agree with, and ADR 0002 already gives it one owner.

## Consequences

- Legacy writers now advance the revision. Fingerprints built on it (payroll source, time-correction evidence, automatic-break intents) see legacy changes as well.
- Historical repairs, the canonical backfill, the legacy import and demo data also write through work records. Only SQL migrations are exempt from the scanner rule.
- Retiring legacy admission later means deleting work records' legacy writer, with no changes to callers.
- The scanner reports every column, update and delete of these tables, and names the few other writers by what they write, none of it completed work (#1230): live work, pending corrections (an employee's inactive correction entries until a decision), Approvals' workflow references on a work period, and absence records, which share `time_record` but never its work tables. Live-work functions must name the live work in their own `where` and never set an end.

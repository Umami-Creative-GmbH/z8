# Payroll Canonical Reconciliation

## Problem

The payroll workspace now checks canonical time-record readiness before
calculating totals. That readiness check compares legacy work-period and absence
IDs directly with canonical time-record IDs.

Current write paths create a canonical `time_record` first and store its ID in
the legacy row's `canonicalRecordId`. The legacy row and canonical row therefore
have different valid IDs. Reconciliation ignores that link and permanently
reports the canonical row as missing. Additional canonical-native records can
also increase canonical counts without representing missing migrated data.

The repair backfill cannot resolve either condition because linked canonical
records already exist and canonical-native records do not need legacy rows.

## Design

Reconciliation will treat `canonicalRecordId` as the source of truth for linked
legacy records:

- For a linked work period or absence, compare the legacy data with the
  canonical record identified by `canonicalRecordId`.
- For an unlinked legacy row, continue expecting a same-ID canonical row so the
  existing backfill can repair it.
- Check work/absence detail rows and project allocations against the resolved
  canonical record ID.
- Continue reporting missing canonical links and null absence organization IDs.

Canonical-native records that have no legacy counterpart are valid. Count
metrics must represent missing legacy coverage, not absolute differences
between legacy and canonical table sizes.

## Error Flow

1. Payroll resolves the assigned officer and organization-scoped employee
   access.
2. Reconciliation resolves each legacy record's expected canonical ID from
   `canonicalRecordId`, falling back to the legacy ID only when no link exists.
3. Missing records, detail rows, allocations, duration parity, approval parity,
   and legacy linkage gaps remain repairable mismatches.
4. Additional canonical-native rows do not create a mismatch.
5. The existing backfill runs only for genuine migration gaps.
6. Payroll totals remain blocked if genuine gaps remain after repair.

## Security and Integrity

- Payroll officer grants and employee scope remain unchanged and
  organization-scoped.
- Reconciliation queries remain filtered by `organizationId`.
- Canonical records are accepted only when their IDs appear in the
  organization-scoped canonical query result.
- Missing or inconsistent linked records remain fail-closed.
- No production data is deleted or rewritten by this code change.

## Testing

Regression coverage will prove:

- A work period linked to a differently identified canonical record reconciles.
- An absence linked to a differently identified canonical record reconciles.
- Duration, approval-state, detail-row, and project-allocation checks use the
  linked canonical ID.
- Canonical-native records do not block readiness.
- A missing linked canonical record remains a mismatch and still triggers the
  existing repair/fail-closed behavior.

Run focused reconciliation, cutover, payroll summary, payroll access, and
payroll action tests, followed by type checking and the complete webapp suite.

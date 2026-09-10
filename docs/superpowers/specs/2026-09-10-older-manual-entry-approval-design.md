# Older manual entries: manager approval instead of age rejection

## Goal

Employees can submit older manual time entries for approval instead of being rejected because the entry exceeds the change policy's approval window. Recent entries retain the existing policy behavior.

## Agreed behavior

- A policy result of `direct` continues to create an approved entry. This includes the existing self-service window, trust mode, and no-policy behavior.
- A policy result of `approval_required` continues to use the existing pending manual-entry approval workflow.
- A policy result of `forbidden` due to `beyond_approval_window` uses that same pending workflow instead of returning the age-limit error.
- Organization owners and admins retain the exemption implemented in commit `df456f8e`.
- Creating entries on behalf of another employee retains its existing authorization and approval behavior.

## Implementation boundary

Change the mapping from edit capability to `requiresApproval` in `createManualTimeEntry` in `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`. Do not change the shared change-policy evaluator: corrections to existing entries are outside this scope.

Reuse the existing transaction that creates the clock entries, pending canonical work record, pending work period, and approval submission. Reuse manager resolution, configured approval policies, notification dispatch, approve/reject handling, and submission replay protection. Existing workflow configuration, including any configured auto-completion, continues to apply; entry age does not introduce a separate approval mechanism.

## Validation and failure handling

Continue enforcing authentication, organization scope, target authorization, valid time ranges, overlap checks, project/category access, and timezone capture. Authorization or policy lookup failures continue to fail closed.

If the existing approval resolver cannot find an eligible manager and rejects the submission, retain that error and transactional rollback. This change removes age-based rejection, not the requirement for a routable approval request. No orphan pending records should be committed.

## Verification

Update the manual-entry action regression tests to demonstrate:

1. An entry beyond the approval window succeeds as pending and creates the existing manager approval submission and notification.
2. Its canonical work record and work period are pending, rather than approved.
3. Recent entries that receive `direct` remain automatically approved.
4. Existing approval-window entries continue through manager approval.
5. Owners/admins retain automatic approval for older entries.
6. Policy and authorization failures still fail before mutation, and missing-manager behavior remains consistent with the existing submission path.

Run the focused clocking and relevant approval tests. Live or database-backed verification requires the project's environment secrets and should be reported as skipped when unavailable.

## Scope

No schema migration or new UI is required. The manual-entry response already communicates `requiresApproval`, and the existing pending workflow supplies its status and notifications. Policy settings and corrections to existing entries are not changed.

# Independent correction review

Read-only review of the eight paths listed in `.tmp/1730-root-checks/root-changed-paths.json`, their working diff, canonical public officer/decision wrappers and server action signatures, and installed TanStack Form 1.33.5 source. No test/package/runtime/Git/tracker/network mutations or private fixture inspection. Only this TEMP note was written. No runtime reproduction was performed by this reviewer.

## Findings

No consequential correctness defect found in the correction. This is static review, not independent test-pass evidence.

- `bulk-document-requests-dialog.tsx:120,200`: DOM submit synchronously reserves the current arrival before TanStack's validation awaits. Explicit submit metadata survives those awaits; the callback checks both current arrival and reservation before dispatch, and checks arrival after transport settlement. The outer finally releases only its own arrival reservation, including invalid submissions. The existing Activity regression exercises queued validation and fresh submission with the real form.
- `use-document-request-confirmation.ts:25,35,46,50`: layout lifetime covers open, target ID, version, unmount and React Activity. Submission captures ID/version at activation. Dispatch and post-await guards in `document-request-decision.tsx:177` and `cancel-document-request-dialog.tsx:49` use the captured operation. Identity-specific release cannot clear another submission. Real installed TanStack retains explicit metadata; native `onSubmit` plus preventDefault is compatible with this API.
- Pending Cancel/Keep/Escape guards check refs and current TanStack submission state; successful submission deliberately calls the parent close directly after its current-operation guard. Transport rejection remains inline and retains reason; current conflict retains the required toast/callback; stale completion returns before UI callbacks.
- `document-requests-workspace.tsx:74`: a matching failed-null retired arrival displays Retry while withholding retained rows/actions. Same-filter ordinary failed refresh still uses retained records with decisions disabled; existing tests cover both behaviors.
- Public action contracts still accept `requestId`, `reason`, `expectedVersion`; the server retains live access resolution and version checks. The correction does not need an API, auth, schema or writer change.

## Meaningful coverage gaps (non-blocking; no failure observed)

`document-request-confirmation-lifetime.test.tsx:111,151` covers queued retirement for Activity/revision and already-dispatched late success only for unmount. A concise table-driven extension could hold a public Return/Cancel action, change version or hide/show Activity, then settle the old action (success/conflict/rejection) and assert no feedback/refresh, followed by a fresh confirmation using the new version. A direct public `CancelDocumentRequestDialog` render can additionally exercise queued target A -> null -> target B, since the nullable-target branch is not currently exercised by the permanent wrapper tests. Static guards appear correct for these cases; these suggestions are regression coverage, not claimed defects or expanded ABA guarantees.

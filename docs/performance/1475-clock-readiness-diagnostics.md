# Observe clock readiness without changing its predicate

This diagnostic records the existing public header operator's last DOM decision,
cached status provenance and one-shot REST write acknowledgement. It adds no
status request, CDP command, reload, retry, wait or timer. The existing readiness
predicate, observation timeout, one-submit rule, outcome-known handling and all
mixed/browser/application/native gates remain unchanged. HTTP success never
assigns hasEmployee or isClockedIn, and supplies no ledger-state claim.

The existing DOM evaluation retains its original decision before inspecting at
most 32 matching controls. Fixed counts distinguish visible/disabled and Clock In/
Clock Out controls, marker enums, conflicting usable labels and truncation. Only
the last observation is retained. Extra diagnostic-read failure returns unknown
metadata while preserving that original decision; original read failures still
propagate. No DOM text, dump, URL, account, action ID or response body is exported.

Existing request/response callbacks record relative event order, an action-header
SHA, fixed parsed status types/booleans and completion age. At most 10,000 weak
request identities and event ordinals are observed; overflow is explicit. Main
navigation events supply a relative generation and the existing actor checks
stamp that generation. These are observed-order facts, not a CDP loader or native
principal certificate. Missing order stays unknown. Out-of-order status updates
are reported; this metadata-only change intentionally does not repair them.

The accepted REST response stays separate from cached status. Its action, actual
matched request order, HTTP/success facts and relation to the current attempt are
recorded with fixed failure-stage enums. No request body is copied. An accepted
write with an enabled expected legacy label can therefore still fail the old
stale-status predicate, and that failed result remains censored and failed.

submit results, prepare failures and the final mixed report retain synchronous
diagnostic snapshots. No per-poll history or extra settle/drain is introduced.
Pending status reads remain explicit; disposal removes the added listeners.
The original failed mixed run is immutable. A fresh Root-operated clock cycle,
independent native reconciliation and review are required before proposing any
positive readiness refinement; this diagnostic claims no new acceptance.

# Semantic-obligation observations

This is a bounded diagnostic census, not a semantic cache. Every existing queue
pop, guard, visited decision, role, error and proof counter still executes.
An observed repeat does not mean its descendants completed or permit reuse.

`bounded-semantic-obligation-observation-v1` is retained within each inspection's
model-cost snapshot, including the existing bounded child snapshot at outer caps.
It compares exact parser objects with actual record provenance, the last actual
model/outlined/collection reference, full role, all four flag presence/value
pairs, exact fallback ancestry and fixed arrival enums. Primitive values have
kind counts only. Root provenance is assigned only when its actual record value
is that same root object; generic resolution without an origin trace stays
unknown. No extra model resolution is performed for the census.

Objects, source records, references and ancestry members use RAM-only identities.
The eager and semantic censuses share4096 identity and1024 context slots. Object
identities themselves also consume that shared allocation. Overflow/unknown is
explicit, and fixed role/kind counts continue after allocation stops. No IDs,
paths, names, values, reference strings, Sets, pointers or ordinals are persisted.

Work is split into pre-queue, committed pops, active pop prefix, guard-only and
post-queue charges. Snapshots project an active prefix without mutating counters;
finally commits it exactly once. A return snapshot therefore remains accurate
before finally, including path-limit and queue-width returns. The local-inspected
guard can fail with no new model charge, while the shared guard adds its existing
single charge before a pop. Embedded work remains separate. Scheduled children
are actual pushes, not an assertion of completed descendant work.

Source tests cover exact identity versus equal JSON, array-role/flag and ancestry
separation, required edges in both orders, active returns, both no-pop guards,
unknown resolved provenance, post-queue work, and shared overflow/privacy.
The earlier canonical-reference flag vector could not observe two target pops
because existing visited logic suppresses the second; the final vector uses
outlined aliases without changing that logic.

The bounded synthetic differential preserves all semantic/guard/error/memo/proof
fields. Its explicit diagnostic exclusions are the new census/shared-allocation
fields and the older eager allocation counters first/repeat/unknown/context/
identity-overflow/context-overflow plus its truncated summary. Sharing the same
bounded allocation can change those earlier diagnostics. It is not accurate to
claim every old diagnostic field remains byte-identical.

No actual payload was reparsed for validation, no historical capture requalified,
and no runtime improvement or baseline/budget acceptance is claimed. Model100000,
depth64, byte/row/retention limits and numerical policy9 are unchanged.

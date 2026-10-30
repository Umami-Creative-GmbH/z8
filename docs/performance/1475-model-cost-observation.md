# Bounded model-cost observations

This diagnostic follows the source-only analysis of the failed Root073/4dbe
wrapper profile. It changes no memo eligibility, borrowing rule, semantic role,
error check, model charge or limit. No runtime improvement is claimed.

`bounded-model-cost-observation-v1` records each inspection separately. Its
charged work is the sum of the seven existing charged sites. Each site retains
65 fixed depth counters plus an unknown-depth counter; semantic/tree charges do
not acquire an invented eager recursion depth. Embedded work is the actual
shared-budget delta minus this inspection's own charged work. The failed
100,001st charge remains counted, while a depth65 failure still charges no
additional model step.

Candidate costs are inclusive and overlap across ancestors. At most256 fixed
reason-mask buckets retain count, successful-local-return count, total/max work
and maximum observed span. Bits1/2/4/8/16/32/64 correspond to seen model,
seen container, active anchor, skipped element, opaque value, removed field and
old-parent certificate. Bit128 records canonical wrapper-shape observation.
Unfinished candidates at a limit retain only mask/work/span. Neither a local
return nor its cost bucket is a completed dependency certificate.

Dependency census keys remain RAM-only. Exact container/origin/force calls are
compared with incoming depth, seen members, active outlined-scope identities and
parent-depth-scope identities. A repeat in a different actual scope is reported
as different, without asserting equivalent obligations. The census holds at
most4096 identity ordinals and1024 context entries; each context component has
at most64 members. Overflow or an unsupported context is explicitly counted and
marks the diagnostic truncated. Output contains counts only, with no model IDs,
names, paths, values, object references or scope ordinals.

Active-anchor/container events additionally distinguish a known same owning
outlined scope from a different or unknown owner. Existing standalone parent
certificates retain a diagnostic mask of the original full validation's observed
borrow events. Their later uses count original seen/active observations
separately. This mask is never read by a reuse or acceptance condition.

The counters are auxiliary observations. CORE error history, raw failure
partitions, required-body proofs, original90/HEAD30 windows, depth64/model100,000
and byte/row/retention limits are unchanged. Missing or truncated diagnostics
grant no permission and cannot turn UNKNOWN into completion.

# Mixed first-failure observer diagnostic

This prospective observer-only change records the first failed existing mixed progress guard. It does not establish the cause of the prior v32 stop: that run retained no failing live cut. A synthetic pending-EOF window demonstrates that the original guard can reject while its exact proxy proof is not yet available; the rejection remains unchanged.

The first failure retains a fixed stage/subreason, only the predicates actually evaluated, nullable application and coverage counters, browser/failure event ordinals, a hashed failure-set identity, and the uniquely latest recorded failure plus its exact proxy-ID match's current proof presence/completeness/reason hash. Missing or ambiguous identity remains null. It reads only the original cut and already-produced predicate results, never response bodies, another input snapshot, a parser or classifier replay. It emits no URLs, header values, cookies, IDs, messages or stacks.

The existing callbacks, short-circuit order, errors, original thrown object, acknowledgments, deadline formulas and waits are retained. Successful snapshots keep their original keys and byte accounting. The first failure is sticky and snapshot copies cannot mutate it. Diagnostic access uses own data descriptors and excludes proxies, so it cannot invoke new getters or traps.

One failure-only record reserves 32 KiB within the existing 32 MiB retention ceiling and 10,000-record ceiling. The maximum bounded event projection test checks serialized bytes times eight plus 2,048 against that reservation; no event array is copied into it. If the existing bounds cannot retain it, overflow remains explicit and the guard remains failed. No threshold, classification, numerical formula, app source or fixture policy changes.

The registered pure/mock tests preserve existing positive/final replay cases, reproduce pending-EOF check and confirm failures, distinguish acknowledgment/token/journal stages, preserve callback counts and original exceptions, check successful schema identity, and cover hash-only privacy, 10,000-event bounds and detached snapshots. Root owns all real runtime verification. Earlier failed runs remain failed.

Each live evaluation clears its nullable facts before the original callbacks. `cutStage` identifies when the retained input was actually evaluated, including later acknowledgment/token/seal failures; it is not a new failure-time snapshot. A failed or unavailable first recording attempt is never retried or relabeled by a later sticky failure. Proxy exclusion precedes array introspection.

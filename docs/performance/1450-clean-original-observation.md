# Clean original and optimized observations

The release requires clean original and optimized runs: successful UI, complete samples and resource proofs, and zero query or pool acquisition errors. Earlier annual-failure exceptions and censored timeout fallback budgets are superseded; preserved failed attempts remain historical diagnostics.

The user authorized a prospective original observation window of 90 seconds and a shared PostgreSQL pool acquisition timeout of 60 seconds for both binaries, with pool maximum 10. Optimized per-visit gates remain 30 seconds. Workloads, dates, counts, error gates and budget formulas stay unchanged. This is an observation condition, not a performance backport into the original application.

`POSTGRES_POOL_ACQUISITION_TIMEOUT_MS` configures the shared pool timeout. Its default remains 10,000 ms; configured values must be positive safe integer milliseconds within Node's timer range. The resolver validates values even when CI skips environment-schema validation.

Both binaries must be rebuilt with the same minimal timeout configuration change and unchanged maintained Next patch. New exact source/configuration bindings and actual clean bounded observations are still required before a new controlled capture or budget registration. No earlier failed observation is reclassified by this change.

The shared evidence gate checks each current sample's measured, prerequisite and cleanup trace identities. Query and acquisition error counts must be known zero in each scope. An absent nonmeasured metric row is allowed only with its exact registered, closed, drained zero-work native proof; no missing metric is filled with zero. Finalization and budget derivation independently enforce the gate.

The existing context proxy also observes bounded response copies without holding or changing forwarding. Only compiled, named analytics/report action contracts and explicit Flight server-error records supply application semantics. Nested domain values and unrelated actions are outside that claim. Required named-contract coverage, pending or unknown results, decoding failures and capacity overflow reject evidence. Encoded and decoded payload limits are explicit; reports contain counts and fixed contract names, never action IDs, response bodies or error messages. Golden UI, native closure, full resource coverage and wire-error gates remain required.

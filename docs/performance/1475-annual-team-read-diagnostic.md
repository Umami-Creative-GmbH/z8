# Annual TEAM read diagnostic

The existing selector now records one fixed non-authoritative diagnostic after an observer is armed. Fixed stages distinguish passive response errors, read-guard rejection, notify/candidate/document/CORE/copy rejection, deadline and close. The first failure is sticky. Candidate IDs remain distinct from selected IDs: a selected hash requires the actual handle and response WeakMap association. Unvisited facts remain null; no messages, stacks, causes, URLs, headers or payload values are retained.

No live diagnostic copy is published. A failed closed observer retains the same frozen record with a 16 KiB charge carved from its existing 32 KiB arm reservation. Pure tests bound the maximum serialized record times eight plus 2 KiB below that reservation. On success, the row is copied and frozen inside the existing CORE serialization, measured by the unchanged 1 MiB check; the snapshot points to that same owned row and the closed charge remains 1 MiB. Unarmed observers retain zero bytes and null diagnostics.

Predicates, callbacks, await order, timers, caps, error counters, parser and classifications are unchanged. This adds evidence for a future fresh Root-owned run; earlier failures remain as recorded.

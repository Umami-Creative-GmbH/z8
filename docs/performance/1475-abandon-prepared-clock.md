# Discard a never-submitted clock handle

A mixed observer guard can fail after a clock control is prepared and before its submit method is called. The prepared control remains armed, so the existing authoritative UI resolution rejects it before the runner can clean up earlier owned live work.

The public prepared handle now has a synchronous abandon method. It succeeds only before submission starts and only once. It releases that handle's armed state, makes every later submit on that handle reject, and performs no Page call, wait, click, status read or write. An old abandoned or submitted handle cannot disarm a newer prepared handle. After submission starts, abandon returns false and preserves the unknown-write resolution requirement.

The runner calls abandon on its existing command exception path before entering its existing fresh-UI resolution and cleanup. Its failed, censored and unknown outcomes remain unchanged. Readiness predicates, required observations, deadlines, workload, caps and retries remain unchanged. Successful preparation clears the stale prepare-control diagnostic label; that label no longer suggests a completed preparation is still in progress.

Public mocked-Page tests cover discarded OUT followed by fresh resolution and one ordinary cleanup OUT, absence of Page calls or writes during discard, rejection of a discarded handle, repeated/stale handles, in-flight submission and unknown submitted writes. No actual app run, ledger operation or historical failure reclassification is part of this change.

# Source-read context supersession

This prospective fixture repair schedules source-read observation on every actual
CDP execution-context create/destroy/clear event, including nondefault contexts.
It applies the same observation condition to both fixture phases.

A source ACK receives the exact event token that scheduled it. After successful
frame/evaluate IO and result-shape validation, an explicit document/execution
journal revision check may emit a private in-process supersession sentinel. That
attempt is retained as unavailable with null document/controller and cannot issue
a cut. A later actual event may schedule its own read under its first recorded
10-second observer deadline. It cannot backfill any earlier selected request.

Generic CDP exceptions, malformed results/journals, cookie/source-file failures,
subset loss, timeouts and pending-close errors remain blocking. A simultaneous
real failure remains sticky even if a structural supersession was observed. The
default mixed acknowledgment path keeps its existing error behavior. No worker
activation or known-none controller premise changes.

All existing 128-row source subset, 10,000-record, 8 MiB source-read reservation
and shared 32 MiB retention limits remain unchanged. No business wait, retry,
drain, timer renewal, application request, workload or numerical gate is added.

The failed Root30d/v31 run remains failed. It recorded execution ordinal5/default
context3 followed by ordinal6/nondefault context4, but did not record its exception
stage. This supports the targeted race hypothesis; it does not prove the old
exception cause or qualify that capture. Fresh Root-run evidence is required.

The regression uses synthetic CDP events through the actual ACK and scheduler:
the ordinal5→6 race is unavailable without a cut, the actual successor can issue
a new cut, and coincident CDP/cookie/source/malformed/frame faults still block.
Additional tests retain timeout/pending facts, default mixed rejection, subset
loss and close behavior. These are pure/mock tests, not browser qualification.

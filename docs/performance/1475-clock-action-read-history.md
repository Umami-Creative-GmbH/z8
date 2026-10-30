# Clock action read history

The public header observer now retains a prospective per-attempt action lifecycle
view. A later unrelated server action no longer hides whether an earlier clock
status request started, failed, remains pending, returned OUT, or delivered IN
while the rendered header still showed OUT. Action header digests permit a later
join to the independently verified compiled registry; the observer does not infer
an action's identity from its response shape.

The existing request and response callbacks populate fixed metadata fields:
request, response, failure and completion ordinals; observed document generations;
HTTP status; parse outcome; actual returned status booleans; and whether the
existing status-cache assignment ran. A passive `requestfailed` listener records
only the failure event, without reading an error message. Raw request objects are
only existing WeakMap keys. No URL, action identifier, header value, body, user
value or exception text enters the view.

The live view reserves a fixed 2 KiB envelope and 960 bytes before each of at most
32 rows, within 32 KiB. Header values must be own data strings of at most 1 KiB
before hashing. The fixed row schema stays below its allowance. There is no
per-poll history. Command snapshots use the existing result path and fixed
40-command workload. These are diagnostic bounds, not a new protocol retention
allowance or an exact JavaScript heap metric.

Prepare discards completed rows and carries the same pending rows forward. Their
original request ordinals and generations remain intact; separate fields identify
the original and current attempt. A failed request with an unresolved body read
stays pending until that existing read settles. Overflow and missing or malformed
identity observations make completeness `UNKNOWN`; resets do not clear that
uncertainty. Snapshots are detached copies.

The latest status, DOM readiness predicate, accepted-write checks, actor checks,
outcome handling, polling and deadlines remain unchanged. No additional request,
refetch, wait, click or acceptance authority is introduced. This diagnostic does
not qualify or reinterpret previous failed runs.

Mocked public-observer tests cover the latest-only information gap, repeated
prepare with a late carry-in completion, failed and pending reads, actual OUT/IN
delivery, stale DOM, malformed identities, the exact row limit, detached snapshots
and listener disposal. They do not reproduce application cache or browser queue
timing.

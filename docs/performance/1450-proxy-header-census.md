# Owned proxy upstream-header census

`scripts/performance/proxy-header-census.mjs` is a pure, unwired observer. It records facts about one owned proxy context's upstream response headers. It does not establish browser cookie coverage, stable principal identity, or Native eligibility.

Create it with `createProxyHeaderCensus({ contextId })`. The technical context ID must contain 1–128 ASCII letters, digits, underscores or hyphens. Request IDs have the existing proxy form `<32 lowercase hex trace ID>.<positive decimal application ID>` (at most ten decimal digits).

| Method | Adapter obligation and recorded fact |
| --- | --- |
| `accepted(requestId)` | Call once for every accepted proxy request, across every allowed origin, before forwarding. Creates an explicitly pending header observation. |
| `headers(requestId, headers)` | Call once with the actual complete upstream header object, before forwarding `writeHead`. Own data properties only are inspected. An empty known object proves no Set-Cookie field; unavailable or malformed input remains unknown. |
| `terminalBeforeHeaders(requestId, { upstreamClosed: true, headersReceived: false })` | Call only after an actual upstream terminal event proves no response headers arrived. This records that distinct fact; it does not assert successful delivery or turn it into a known no-cookie response. |
| `observerError()` | Retains an observer error, including after close. |
| `close()` | Call only after the actual transport lifetime ends and its final callbacks have been observed. Pending rows stay pending. Repeated close and later callbacks remain faults. |
| `snapshot()` | Returns detached technical facts, recomputed counts and a canonical facts SHA-256. Repeated snapshots do not reset the observer. |

The eventual adapter must observe page and worker traffic and keep this observer alive through browser cleanup until transport closure. This helper cannot prove that an adapter called it for all real requests, or that a supplied terminal fact came from a real event.

Each context retains at most 10,000 request rows and 10,000 fault rows. Further faults retain counts by kind and set overflow; excess requests remain an overflow fact. A header snapshot permits at most 10,000 fields/values and 65,536 UTF-8 bytes. These are observation bounds for this unwired helper. They do not change benchmark limits. Oversize or malformed headers become unknown. No raw headers, cookies, URLs or cookie values are retained; a present Set-Cookie field retains only its line count and the SHA-256 of its ordered JSON string array.

`validateProxyHeaderCensus(snapshot, { contextId })` validates the exact canonical serialized schema, unique request IDs, bounded facts, recomputed counts and hash. It accepts well-formed **incomplete or adverse facts** too. There is no `clean` or `eligible` boolean. The digest binds the technical receipt; it does not authenticate the event source. Preserve the emitted property order when serializing.

Consumers must separately reject pending, unknown headers, Set-Cookie, observer errors, missing identities, duplicate events, late events and overflow when requiring a clean observation. They must also retain terminal-before-headers failures under their existing transport rules and enforce all independent browser, principal, semantic, body, resource and Native gates. No consumer is wired by this change.

Pure verification:

```powershell
pnpm --config.verifyDepsBeforeRun=false node --test scripts/performance/proxy-header-census.test.mjs
```

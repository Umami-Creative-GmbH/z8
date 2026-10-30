# Fixture proxy upstream socket policy

The fixture proxy uses one upstream HTTP Agent per browser context with
`keepAlive: false` and `maxSockets: 64`. It does not retry requests. The browser's
connection to the proxy, forwarded headers and streamed bodies are unchanged.

This is a new common measurement condition for both original and optimized
builds. Connection setup costs remain measured. Fresh source fingerprints,
browser-control bindings and functional evidence must precede any new full
baseline or release capture. Existing failed captures remain failed; this change
does not establish benchmark acceptance or a general cure for connection resets.

The source investigation followed a recorded upstream `ECONNRESET` on a POST
whose ClientRequest had `reusedSocket: true`; the proxy returned HTTP502 and the
body had no natural EOF. It remains a genuine error. The retained actual Node
26.9 `_http_agent` source has SHA256
`e0c3f417ed0f2d08d57b3d9048b807b48c9175596c60fd25932adda17b812b83`.
Its free-pool selection calls `reuseSocket`, which sets that flag. With idle
retention disabled, a completed socket with no queued work is destroyed instead
of entering the free pool. This removes the observed avoidable reuse path; it
does not prove the reset was caused by an idle timeout.

Node can still hand a just-freed active socket directly to already queued work.
That behavior and the existing active limit remain. The condition does not claim
every request creates a new TCP connection. No Connection header, timeout,
concurrency limit, resource bound, request recipe or numerical factor changes.

Every transport snapshot and its empty-browser initialization evidence carry
`upstreamSocketPolicy`:

```json
{"protocol":"no-idle-upstream-sockets-v1","keepAlive":false,"maxSockets":64,"retries":0}
```

The shared primary/companion/mixed transport gate requires the exact policy at
both cuts. The paired-instance transport gate has the same requirement. Missing,
legacy, malformed or changed policy facts fail; they are not defaulted. Socket
policy metadata is kept outside numerical counter subtraction. The existing
`context-loopback-proxy-v1` framing identity and numerical policies remain.

Pure/mock tests cover actual Agent arguments, original pipe delegation, one
attempt on a failed POST, retained reset/error counters and strict receipt
negatives. The real loopback regression is for the controller owner to run:

```powershell
pnpm --config.verifyDepsBeforeRun=false node --test scripts/performance/trace-transport.test.mjs
```

It verifies actual idle socket closure, distinct subsequent upstream connection,
unchanged POST body/status/technical header and a genuine reset producing one
HTTP502 with no retry. Agent-only checks select `upstream socket policy mock`;
they do not execute that socket test. All genuine browser, application, SQL,
transport, unknown, native, restoration and final-closure gates remain strict.

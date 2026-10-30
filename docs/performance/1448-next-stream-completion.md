# Next 16.4 stream completion patch

A real client-aborted prefetch left Next's `BaseServer.handleRequest` promise
pending after its HTTP span ended. The native observer correctly rejected that
visit. An exact SDK HTTP-parent/forward-parent bridge identified the aborted
request; a fresh two-visit reproduction showed that cache age was unnecessary.
Those failed C5 observations remain invalid and unchanged.

The installed Next web-stream writer resolves its `finished` promise only on
`finish`. If a client disconnects while `writer.close` awaits `waitUntil`, the
response becomes destroyed without becoming finished. After the wait settles,
ending that closed response can leave the pipe and its real SDK request span
pending. The maintained `next@16.4.0` pnpm patch changes both CJS and ESM forms:

- Resolve the existing `finished` promise on response `close`, beside `drained`.
- After still awaiting `waitUntil`, return for a destroyed or finished response.

The patch retains AbortSignal/stream cancellation and final-work waiting. It does
not end spans manually or change native accounting, filters, caps, transport
cancellation or prefetch behavior. The existing Drizzle patch remains unchanged.
pnpm generated the patch and workspace registration through its
[patch workflow](https://pnpm.io/cli/patch-commit). The lockfile changes only the
Next patch identity and equivalent peer-context encodings; a normalized audit
of both lock documents confirms unchanged dependency versions and resolutions.

`scripts/performance/next-stream-completion.test.mjs` runs actual installed CJS
and ESM function bodies, real local HTTP requests, the actual Next tracer and
NodeSDK. Node's ESM resolver adapter changes import resolution only. It verifies
normal completion, active-stream cancellation and disconnect during final work.
The final work remains pending until explicitly released; all six successful
cases then end their SDK SERVER spans naturally. Unpatched private controls fail
with a live SDK span; both patched forms pass. The canonical regression is also
included in the root Node test commands.

```powershell
pnpm --config.verifyDepsBeforeRun=false exec node --test scripts/performance/next-stream-completion.test.mjs
```

The user authorized this common framework correction for original and head.
Both controlled runtime builds must use the identical maintained patch and
lockfile. The local regression is not compiled-fixture acceptance: the exact
original first-document/return condition must pass with real cancellations,
complete native/server/row/transport evidence and unchanged strict gates. New
before/head source qualification, a new prospective freeze and numerical budgets
remain required. No old observation or budget is retroactively upgraded.

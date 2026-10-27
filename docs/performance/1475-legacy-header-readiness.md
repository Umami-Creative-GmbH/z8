# Qualify the legacy header's usable clock label

The legacy header can render an enabled Clock Out control after a successful
clock-in while an independently observed older status response still says
clocked-out. The old observer then rejects that rendered state for the entire
unchanged observation window. This correction adds one source-qualified DOM
path; it does not assign status from the write response or change the app.

The two existing positive paths remain unchanged: an actual ready marker, or
an independently matching known status. The new path applies only when those
would yield unknown, and requires the exact privately qualified binding plus
one visible enabled native header button, no conflicting control, no truncated
census and no status marker. CSS visibility, effective disabled and aria-disabled
states are checked. Pending, unavailable, unfamiliar markers and missing source
qualification cannot use this path. An existing positive status/marker result
is preserved even in a case the new path refuses.

The source closure includes the header/popover, its hook and reexport/key,
offline invalidation, Dashboard SSR initializer, and Button/Popover adapters.
The hook has no optimistic status write; commands invalidate status. The shared
Dashboard initializer can provide a server-rendered status snapshot, so this is
usable rendered-state readiness, not a claim of a newly finished canonical read.
Actor/session verification, accepted-command checks, one-submit behavior,
90s-original/30s-HEAD deadlines and all browser/application/native/resource gates
remain separate and unchanged. Historical failures remain failed.

## Pre-IO source qualification

Optional browser-control metadata `legacyClockReadiness` has exactly:

```text
protocol: source-qualified-legacy-header-readiness-v1
compiledBuild: actual full compiled source
compiledManifestSha256: actual required-server-files.json SHA256
originSha256: SHA256 of the actual normalized serving origin
phase: baseline or release
review: { path: absolute private JSON, sha256: actual bytes }
buildRecord: { path: absolute actual CI JSON, sha256: actual bytes }
```

The actual binding reader checks the manifest as before, acquires the exact
review/build bytes and reads the ten fixed source paths relative to that app.
Source bodies are bounded per file and in aggregate. UTF-8/LF canonical hashes
and computed Git blob IDs must match the reviewed finite closure; physical bytes
must match the independently reviewed file records. Actual BUILD_ID must equal
the CI record's buildId, with ci=true, exitCode=0, ordered timestamps and source
matching the actual compiled build. No build hash is permanently fixed to bfdf:
a future unrelated approved app correction needs its own real CI/source/manifest
join while all reviewed header-closure blobs stay equal. The existing common
seven-file certificate and any separate app-correction hunk authority remain
separate; this is no eighth whole-file equality claim.

The private Root review has exactly schema=1,
kind=root-reviewed-legacy-header-readiness-source-v1, accepted=true,
compiledBuild, compiledManifestSha256, sourceCommit, originSha256, phase,
buildRecordSha256 and files. Each ordered file row is exactly file,
canonicalSha256, gitBlob and physicalSha256. The actual compiled source must
match sourceCommit and the CI source. The ten fixed paths/hashes are exported
as read-only source facts by legacy-clock-readiness.mjs for independent review;
those facts are not capabilities. Root must review the actual compiled-serving
relation and its pinned dependency execution contract before supplying this file.
No accepting operational review is created by the implementation.

Qualified facts are stored in a private WeakMap for the exact binding and
transferred only by the existing actual browser-revision verifier. The header
accepts that object via browserControlBinding. Copies, serialized facts,
caller booleans, unverified bindings, foreign origins/phases and changed source
cannot gain the new path. Metadata snapshots retain only the bounded source
hash/build facts and distinguish qualified-legacy-dom from the existing proof;
no status fields or DOM labels are forced.

All four protocol closures include the new imported source module, expanding
primary/companion/budgets/mixed to19/25/27/16. Their actual new physical source
hashes require a fresh receipt and prospective capture; old frozen receipts
and captures are not rewritten.

Validation uses registered pure/mock tests and an independently reproducible
file-only synthetic acquisition harness. They cover stale-status behavior,
unchanged old positives, source and CI mismatches, ambiguity, loading/disabled,
hidden/aria-disabled/effective-disabled controls and copied authority. Mocked
Browser.getVersion and DOM callbacks are not actual Chrome or ledger proof.
A fresh Root-operated qualified standalone and under-load cycle is still needed.
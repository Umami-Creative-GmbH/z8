# #1738 merger STOP

The bounded public coverage probe confirms an inherited presentation gap that blocks R065 acceptance. No correction or broader acceptance was attempted after confirmation. This is not evidence of successful publishing or a server authorization bypass.

## Pinned merge

- Clean starting AI/origin: `83a3b30f648e74416d628c96509dcee4c765cdba`.
- Incoming: `6744b09d2bc3e8df7de9fa5683f8b30214770838`; actual common ancestor: `58ea18603a936d102f0625e3303f4c05689a9961`.
- Fresh no-fast-forward merge: `11abc6c16bfb770ee6a9bff6053ee4cc9c501178`, with those starting/incoming parents, tree `9f3d38d04ba25f08a43c3a9d20303788958a6273`.
- Independent `git merge-tree --write-tree`: `732ce32f7dd1e3915db310bd0d39695a1a2f068e`; only the conflicted heading-test file differs from that conflict-bearing tree. Resolution preserves every prior line and adds precisely the incoming scheduling test block. Metadata implementation auto-merged with only exact `/scheduling` adoption.
- 119 changed paths: 17 product and 102 incoming report/evidence/harness paths. 117 nonoverlap paths match incoming blobs exactly. All 17,164 preexisting root paths outside incoming delta, all 59 verified anchors, original spec/ledger/inventory, and all 202 tracked files under the #1735 root-recovery-and-pdf prefix are preserved. #1733/#1734 source and proof subsets remain unchanged; no assertion equates historical subset counts to larger physical directories.
- Latest VERIFIED remains the supplied `769a2e7844ed1ff43d6a36145869b50cee921db6`; this merge is unverified. No ledger/readiness/README/proof/tracker changes, push, PR, dev merge or deployment.

## Confirmed public failure

Seam: actual `ShiftScheduler` with real `QueryClientProvider`, Tolgee, theme and preferences providers, Schedule-X, `useShiftSchedulerData`, `useCoverageHeatmap`, `CoverageHeatmapOverlay` and `PublishFab`. No hook state, query data or internal component is fabricated. Only server-action transport and admitted caller props are synthetic. Query retries are disabled to make the failed transport deadline bounded; the query functions and error propagation run normally. This is jsdom assembly evidence, not an authenticated browser or real server-action verdict.

With one synthetic draft shift and successful templates/compliance reads, `getTargetHeatmapData` returns `{success:false,error:"Synthetic coverage transport unavailable"}`. After all reads settle:

- There are zero alerts and zero Retry controls.
- Publish remains enabled and exposes `Publish 1 draft shift and notify employees`, identical to the healthy successful-empty coverage control.
- The healthy understaffed control displays its actual staffing warning and summary, demonstrating that the real coverage-to-publish warning path is connected.
- All publish/upsert/delete transport call counts remain zero. No write was attempted or inferred.

Attempt03: two healthy controls pass; truthful coverage-unknown/error acceptance fails. Attempt04 repeats that failed case alone and reproduces it. Both record zero local Retry controls; the test's later Retry assertion is not reached after its error assertion fails, so the zero count is an observation rather than a passed assertion.

Attempt06 mounts the exact premerge scheduler blob `4591e5db4368b5866ede1c3c57b308a30b795846` at a new temporary path, with current supporting assembly. Coverage hook, overlay and PublishFab are byte-identical at both commits. Two healthy controls pass and the same unknown/error acceptance fails. This is a partial historical consumer comparison: it does not restore the whole old application. The old responsive calendar selects day and performs two coverage reads, whereas the current week consumer performs one. Those range/layout differences prevent a whole-state before/after equivalence claim. The bounded failure and ordinary publish description agree after settlement.

Relevant source: `use-coverage-heatmap.ts:18,44` obtains error but defaults missing data to `hasGaps=false`; `shift-scheduler.tsx:134` consumes only the boolean; `coverage-heatmap-overlay.tsx:251` omits error. The supporting templates/compliance Retry at `shift-scheduler.tsx:296` has `pending={false}`; this remains an unexecuted source hypothesis because the confirmed coverage blocker triggered STOP. Held recovery, deduplication, actor/org ABA, pending permission loss, and wider acceptance remain unpassed here. Existing server publish re-evaluation was unchanged and was not freshly exercised.

## Accounting and limitations

There are three distinct logical cases. Valid verdict runs have seven executed instances: current controls three, current failure repeat one, partial historical controls three. They produce four passing healthy-control instances and three intentional blocker-red instances; the repeat selects out two cases. Three earlier harness attempts execute nine additional instances and are excluded from acceptance. All six invocations therefore have 16 executed instances (four pass, 12 fail) plus two selected-out cases. No PostgreSQL, type, build, Doctor, lint or browser count is added to these numbers. Worker 282 tests and quality evidence remain inherited only.

Earlier harness failures are retained: tooltip `role=tooltip` selection did not match the actual rendered Base UI popup; text selection matching repository tooltip tests corrected it. Historical attempt05 inspected a retired Publish node before Schedule-X's initial range update; attempt06 waits for the real callback and reacquires the live control. No product changes were made to obtain those controls. Attempt01's PowerShell Stop preference reacted to a native Vite warning before its command receipt was emitted; its JSON and source are retained, but it has incomplete command metadata.

The three dependency parents remain physical. Root/app links are the frozen 158 leaves (5 root, 153 webapp); the separate `.pnpm/node_modules` inventory has 1,598 internal links and zero external targets. No install/repair/overlay/config change occurred. Lock SHA256 is `2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799`; inherited license hash is `FD8CA4BF29B59368907AE8D52A5149B3959A901194F424AD605044F67C2F0BBF`, 125 object keys. The initial pins.json `licenseCount=1` is PowerShell's object wrapper count, not a package count; dependency-summary.json supplies the corrected count without rewriting that initial receipt.

Product merge whitespace check passes. Whole-merge whitespace check exits 2 with 108 finding lines across 19 incoming archived evidence/harness paths, all exact incoming blobs; those originals were not rewritten. Broader quality/runtime/PG/full generation/catalog/native/device/provider checks remain unpassed at STOP.

Both new temporary source paths were removed only after exact SHA256 guards. All probe commands completed; a narrowly filtered process query finds zero Node processes in this probe namespace. No Next/browser/container runtime was created, borrowed or stopped; no runtime port was allocated, so no global listener absence is claimed. The AI checkout is clean. Public export is restricted to public-allowlist.json; raw logs, raw tree inventories and other local files are excluded. No credentials or auth/session state were created, copied, restored or read.

Root owns correction, readiness and publication. Final release is communicated explicitly after the final seal and clean-tree checks.

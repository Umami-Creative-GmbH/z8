# Provider arrival and recovery evidence

An old all-scope overview read could finish after the canonical provider employee or display role changed, before refreshed server props arrived. The correction retires that reader and its snapshot, hides failed or unknown context, exposes the provider's actual Retry, and starts a fresh authorized server read. Identity is a retirement boundary; unchanged canonical server permissions decide admission and all/managed scope, including approved administrators without an employee or with an employee display role.

This is bounded evidence publication. `verifiedCommit` and readiness remain null. The publisher ran no application tests, archived drivers, runtime, fixtures or browser. Root owns the independent staged-blob audit, proof commit and separate readiness decision.

- [Capability evidence and qualifications](capability-evidence.md) separates historical STOP, root correction, independent cases and live observations.
- [Public payload index](payload-index.json) lists exactly 60 approved copies / 6,792,696 bytes, with destination, bytes, SHA256 and classification only. Copied safe indexes remain literal historical artifacts; their references are not an expansion allowlist.
- [Source/config pins](source-config-pins.json) bind 20 historical blobs at correction/frozen/publication snapshots. Optional current checking covers only 18 `currentSource: true` pins, excluding two shared metadata files. Later additive heading adoptions must not freeze metadata or the whole app tree.
- [Publication controls](publication-controls/publication.json) and [prefix receipt](publication-controls/prefix-receipt.json) bind the original report and appendix separately.
- [Derived accounting](case-accounting-derived.json) is recomputed from complete copied reports, not a new test execution.
- [Syntax-only receipt](syntax-checks.json) binds copied TS/TSX bytes parsed with existing Next bundled Babel, configuration disabled. No type/build claim. Archived Python drivers remain inert provenance, with no execution or Python syntax claim.
- [File index](file-index.json), [SHA256SUMS](SHA256SUMS.txt) and [seal](seal.json) describe the publication. The index/checksum list exclude themselves and the seal, avoiding circular hashing. The seal hashes both indexes. The private handoff separately hashes every final archive file including these exclusions, plus the full report.

Run [the standalone read-only verifier](verify-evidence.mjs) from the repository root:

```sh
node docs/design/rollout-1692/1742/root-provider-arrival-and-recovery/verify-evidence.mjs
node docs/design/rollout-1692/1742/root-provider-arrival-and-recovery/verify-evidence.mjs --current-source
```

The verifier uses only Node built-ins and read-only Git. It checks exact inventory/copies, historical Git objects, optional current pins, report prefix/append, all JSON, JavaScript syntax through stdin, pinned TypeScript syntax receipts, full PNG decoding against independent intake pixel hashes, new local Markdown links, secret patterns and unchanged archive/report bytes. It neither imports archived modules nor follows private references. Save outputs outside this archive. A passing verifier establishes publication integrity; readiness remains root's decision.

# Root selected-file and Delete activation proof

Fixed production source: `e4d08accbee9b37b2f7bc5068a197f62f74c47a1`. The two root corrections follow provisional merger `e1e25677696ad9dce26b77e1fcb7047db8b2fe1c`; the verified predecessor is `e50692c3bc5194ab1c16d2fe8d12664ab11aafd7`.

From the repository root:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false node --check docs/design/rollout-1692/1729/root-selected-file-and-activation/verify-evidence.mjs
pnpm --config.verify-deps-before-run=false node docs/design/rollout-1692/1729/root-selected-file-and-activation/verify-evidence.mjs
# Optional: also require today's checkout source to match this historical source.
pnpm --config.verify-deps-before-run=false node docs/design/rollout-1692/1729/root-selected-file-and-activation/verify-evidence.mjs --current-source
```

The verifier reads fixed Git blobs and the sealed public allowlist. It checks source/provenance, exact archive bytes, JSON, PNG CRCs and scanline decoding, observed result fields, preservation, restore and cleanup. It never imports archived drivers, executes packages/tests, starts services, uses the network, or changes evidence. Later legitimate source changes, including #1730 route metadata, do not invalidate default historical verification. The optional drift check can fail after such changes.

[evidence-index.json](evidence-index.json) indexes **145** reviewed public artifacts: 40 controls, 19 checks, 74 runtime files and 12 compact merger/preservation records, totaling **4,137,116 bytes**. The runtime set is its released 73-file allowlist plus its public digest seal, with **31 PNGs**. `.gitattributes` preserves all raw bytes, including UTF-16LE and CRLF logs. Top-level control documents are sealed directly by the verifier; the verifier is the reviewable trust anchor. Verification output stays outside the indexed archive to avoid a self-referential seal.

[verification-manifest.json](verification-manifest.json) records acceptance and limits; [source-pins.json](source-pins.json) has 22 fixed Git pins, including eight preserved #1728 paths. [publication-exclusions.json](publication-exclusions.json) describes omitted categories only. No private fixture/auth inputs, session state, literal private command output or byte backup is read or hashed by this publication.

Final accounting is **175 unit + 163 PostgreSQL = 338 unique cases across 34 physical files**. Focused five are a subset. Full units/types/Doctor preceded the final test-only cancelable-submit assertion; the focused five passed afterward. Earlier worker and rerun counts are nonadditive. Both intermediate Delete retry attempts named “green” failed 4/5 and remain failures. The first journey-04 pointer Save never activated selected-route action transport; journey-05 is the distinct accepted focused-Enter submission.

Quality remains qualified: six correction files pass explicit CRLF formatting; the full 14-file format profile fails with eight errors; formatter-disabled lint passes with one inherited unused-suppression warning. Doctor has zero errors and one reviewed false positive, supported by explicit `preventDefault` and the actual cancelable-event assertion; no suppression was added.

The known broad current-roster guard is unresolved and unrun here. Selected-read and activation retirement are narrow presentation/task guarantees. No hidden-Activity fresh-read, all-ABA, shared-late-callback or new metadata revision guarantee is claimed. Runtime skill assignment, sick-note link/unlink, former/cutoff transition and cross-account/org/employee ABA remain unpassed. Earliest shared-shell no-h1 is source-only. The inherited #1728 cutoff-effective projection correction is preserved.

Matched captures are a partial seven-consumer historical overlay, with all other app/framework/helpers/dependencies current. Saved 18px phone checks are distinct from matched 16px/theme emulation. Officer long-title geometry is measured below the PNG viewport; My Documents visibly shows it. Existing overlays can cover lower controls; bounds are not occlusion, physical touch, true zoom, full-build, catalog/provider/customer or global-readiness certification.

# C5: exact DE0 test-only source qualification

The admitted DE0 production build remains fixed: source `de0b1a128b384196c7c93ac69cd5324e8d0cbbd8`, CI record SHA256 `5e0bd9767b1d5d124e0c5204a006332ed0e693c6e99dfcbca043bf34099f6cde`, compiled required-manifest SHA256 `876c31b0d96fb2123be97c8767fd28d1058981a4822ff55d30e93ccc451a1ac3`. A post-build ingress diagnostic adds a component test, not production code. The existing broad `apps/webapp/src` byte guard would reject it, so ROOT authorized exactly two nonproduction differences:

| Qualified input | Exact Git blob |
| --- | --- |
| New `apps/webapp/src/components/dashboard/ingress-failure-timeline.test.tsx` | `ef78ab20c7fcc37926260ee8cedb9ab1e938037a` |
| Original root `package.json` | `98cc588d623476be9501de84f4f9ce7766264937` |
| Qualified root `package.json` | `418b1f287dfc41ce796260676c7495f2d3801806` |

The only package change is `scripts["performance:test:ingress"]`: old value `node --test scripts/performance/ingress-stream-probe.test.mjs`; new value appends exactly ` scripts/performance/ingress-browser.test.mjs`. After restoring that one literal value in memory, the parsed package deeply equals the original. Dependencies, package manager, build/dev/runtime commands and every other field stay identical. Both exact blobs are checked as well.

Read-only Git audit of `b90b93aba65c15ce1be627b4fd5a4e00383a64c7` found no other production/config/package/lock/workspace/build input changes. The only workspace reference to `ingress-failure-timeline` is the new component test itself. It is outside app routes and excluded by the existing, unchanged build tsconfig. Production modules/imports remain byte-identical to DE0. Other changes are external performance tooling/documentation; the controlled primary/companion/budget fingerprint checks remain separate and unchanged. This qualification does not treat an arbitrary `.test` path or package edit as safe.

The scratch module `c5-de0-nonproduction-qualification.mjs` checks this exact test path/blob, base absence, both package blobs, exact old/new command, parsed equality and no production reference. It rejects every other changed input outside the external `scripts/performance` and `docs/performance` directories. This protects all other apps, packages, root files, configuration, deployment/build tools, dependency and lock/workspace inputs. The normal preparation report records the certificate and the qualification module SHA256; freeze recomputes and requires the exact same certificate/hash, then preserves the checked guard source in the new run directory. It does not run that helper during measurement.

| Updated scratch helper | SHA256 |
| --- | --- |
| `c5-de0-nonproduction-qualification.mjs` | `26dc7b38f50e52224f2c7258ccfe567a8c4c7023e118c5dd307dc22d588cb150` |
| `prepare-c5-draft.mjs` | `c36b71d0fddc28d0313d08b33ee72ef9a49789a6ef6bb2284f1e2abb2cd5762e` |
| `freeze-c5-after-controller-release.mjs` | `e2a583ffb4f914150bea66397edb5dc9b66cfda9be0dc769e55894f5b4847a13` |

The actual b90 tree passed offline qualification, then ROOT merged the audited changes into clean `884398dd3a7808feddaa2962c5c16b50796381de` and admitted the owner's normal three post-test TypeScript checks. Normal offline preparation from that actual root passed the exact certificate and all three controlled source maps. Twelve synthetic negative checks reject another app test, production source, configuration, lock/package input, changed qualified blobs, build/package-manager edits, extra production reference and missing exclusions. Syntax checks passed. These are source gates; they do not waive unknown rows, native/resource failures or runtime acceptance. No full Next rebuild is required solely for these exact qualified nonproduction changes.

The b73 sidecar `ad0133...` remains unchanged. ROOT authorized refreshing the mutable draft's runtime tooling pin only: its new SHA256 is `63870f53e4fdd850f2ea662faf17f0c6261d1a650146e46d5b552e4bd3885bdc`; exact C1 non-runtime equality and 114/1380 + 54/1080 counts passed. The NEW active report `before-plan-c5-DRAFT-preparation-root-884398dd3a7808feddaa2962c5c16b50796381de-policy7-qualified-test.json` has SHA256 `ad9e2cd0b380c25a02526e6b64d1da2698f67734a87b26d47bd0b67e29139f03`. Do not rerun over it. Only on later measuring/qualification drift, use normal preparation into another explicitly NEW report and review again:

```powershell
$source = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
Set-Location -LiteralPath $source
$pin = (git rev-parse HEAD).Trim()
$newPrep = Join-Path $scratch "before-plan-c5-DRAFT-preparation-root-$pin-policy7-qualified-test.json"
pnpm --config.verifyDepsBeforeRun=false node "$scratch/prepare-c5-draft.mjs" $source $scratch $newPrep before-plan-c5-DRAFT.json
if ($LASTEXITCODE -ne 0) { throw 'Qualification/preparation failed; preserve existing evidence.' }
# STOP for ROOT review of new plan/sidecar/certificate/maps and runtime-gate release. No freeze here.
```

The qualified sidecar was prepared offline; no runtime IO, admission, freeze, capture, budget derivation or controlled head timing was performed. Original456/business39 failure binding, policy7 numerical factors, full C1 workload and strict native/resource gates are unchanged. ROOT's remaining exclusive scope-probe cleanup and quiet-window release precede any freeze.

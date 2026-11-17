# R158 / #1740 isolated candidate handoff — STOP / product acceptance blocked

Worktree: `X:/t3-code/worktrees/z8/t3-41aa9e05-0348e7c30589d86c`.
Branch: `review/1740-team-absences`. This branch was already prepared by T3;
the initial checkout was clean at the requested root98. No shell worktree was made.

Candidate: `084049d3441465dd1ed0e1eb791eb7750c820488`.
Parents, in order:

- `98bc0c4c82f32af17b0d6aee98fd7e42edc29a86`
- `6473c5b41f387f9bfe1798b91be415c0f43dec02`

Tree: `d1467ac0c34d5ee075962eb6929e06f1677c4233`.
App tree (`apps/webapp`): `3fa5114f758a685a4d90f8dc50bfc670e0c4dfe8`.
Latest VERIFIED remains `769a2e7844ed1ff43d6a36145869b50cee921db6`.
Root98 and #1738/#1739 remain provisional. This candidate is not root integration,
readiness advancement, a VERIFIED checkpoint, or authorization to publish/merge it.

## First confirmed blocker

**P1 current acceptance failure: a submit queued before TanStack `onSubmit` survives
an Activity hide → return and sends a command from the retired activation.**

Relevant candidate source: `apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx`,
lines 102–104, 193–209 and 287–289. The public action calls `form.handleSubmit()`;
the lifetime is first sampled inside `onSubmit`, after TanStack's async validation
boundary. When Activity returns before that continuation, the old queued operation
samples the new activation's lifetime. This is the explanation supported by the
public ordering probe; no internal hook, form store, validator or query status was
replaced to produce the failure.

The actual dialog, TanStack form, ActionPanel, Select, DatePicker, staged-note hooks,
deputy picker, translations, QueryClient, OrganizationContextProvider and
ViewRefreshProvider are used. Mocks are session/navigation and server-action/fetch
transport boundaries. ResizeObserver/matchMedia are DOM environment shims. All
data is synthetic, the action spy returns a refusal, and no server/domain write ran.
This proves client command dispatch; it does not establish an authorization bypass,
live exploit, server revocation failure, cancellation, or duplicate storage.

Reproduction sequence, confirmed twice against the candidate:

1. Fill the actual form through its public Category/DatePicker/Notes controls.
2. Click Record absence. Assert zero command calls synchronously.
3. Commit Activity hidden, verify the dialog is absent from accessible roles and
   command count remains zero.
4. Commit Activity visible, verify the real dialog returns and count remains zero.
5. Let the naturally queued validation continuation settle. **Expected zero commands;
   actual one command to `review-target`.** The eligible draft is retained.
6. Perform a genuinely new public submit after return. It sends a second command
   to that same synthetic target. This is an actual new operation, not just a
   re-enabled button assertion.

The exact same form probe was run after clean, ordinary Git selection of committed
premerge root98 in this already bound checkout, with an owned cold Vitest cache.
It fails identically. Premerge dialog blob:
`a07f2b11a37f26217238434a8df5780e0e2e2e9d`.
Candidate/incoming dialog blob:
`5b94fc5ae304ea0b6f02e32c8e91bcc1fd879e3a`.
**Classification: inherited behavior still failing current acceptance, not a proven
new regression.** The candidate adds lifetime guards but does not cover this earlier
queue boundary. Consider capturing/validating the activation at the public submit
entry before awaiting validation; parent owns the small fix and its design.

Acceptance stopped at this first confirmed blocker. No production source fix or
test weakening was made. The same-commit Activity ordering is a deterministic
component test, not a claim that a particular live navigation was reproduced.

## Fresh execution, separately from inherited reports

- Fresh final candidate probe: **one distinct pass, one distinct failure / one file**.
  The passing assembled test uses the real workspace/table/calendar/providers:
  a failed calendar refresh retains the usable employee list; a change of active
  organization retires the old visible employee records.
- Fresh pinned premerge form control: **one failure / one file**. This overlaps the
  candidate failure identity and must not be summed as additional coverage.
- Earlier candidate repeat: same two identities and same product failure.
- Earlier probe setup failures: ignored-directory discovery ran zero tests; an
  incorrect accessible Category locator failed before the product path. These
  are harness/setup failures, not product failures or passing acceptance.
- Incoming **128 unit cases / eight physical files**, **61 PG cases / four physical
  files**, Doctor 100/11 and explicit 100-column/CRLF lint/format remain inherited
  worker reports, not freshly executed here. PG preceded phone4180 with unchanged
  domain owners. No snapshots or cumulative rerun counts are claimed.
- Root #1738/#1739 **392/60 unit and 12/3 PG** remain inherited only.
- No fresh broad unit, PG, typegen, any of the three type projects, lint, explicit
  format, ordinary format, Doctor, Next, fixture, Chromium, provider, device, true
  zoom or runtime acceptance was run after the stop. Main types retain the genuine
  generated-license qualification; no license was fabricated or copied. Ordinary
  formatter and full production generation/Tolgee/native React limits remain.
- Remaining initial failure/Retry, independent retention, account/org/raw pending,
  role/feature/employee, late settlements/staged cleanup and policy/privacy matrix
  are uncompleted acceptance, not passed by inference from this bounded probe.

Safe synthetic outputs: `public-confirmed.txt`, `public-run-2.txt`,
`premerge-control.txt`. Reusable source: `public-acceptance.test.tsx` and
`premerge-control.test.tsx`. None is a private worker harness replay.

## Independent merge recipe and preservation

`prepare-merge.cjs` built an expected tree **before** the normal own `--no-ff` merge,
using a separate ignored index. This is a manually resolved additive tree; it is
not represented as a pure `git merge-tree` match.

Start with every entry in root98. Overlay the 29 incoming nonoverlap entries
exactly. Resolve only `route-metadata.ts` and `route-metadata.test.ts`:

- Add exact `/team/absences` after root `/team`; retain all 33 root exact routes,
  nine anchored dynamic patterns, normalization and descendant exclusions.
- Keep every root test. Move `/en/team/absences` out of the root negative loop and
  adopt the incoming positive/localized/trailing-slash/deeper-negative case.
- Reconcile incoming `/en/team` to root true. Keep `/en/team/driving` false.
- Retain root personnel-file/report-vehicles positives and their meaningful
  deeper/invalid negatives. No `/team/*` broadening or #1741/#1742 adoption.

The normal merge reported exactly those two conflicts. Applying the independently
prepared resolutions produced the precomputed tree exactly, before commit. The
commit was made with hooks disabled only for this authorized merge commit, avoiding
tracked-writing or unrelated hook execution; no check is implied by that commit.

`candidate-audit.json` independently compares the complete expected map and records:

- **17,397** original root entries outside the incoming delta preserved exactly.
- All **29** incoming nonoverlap entries preserved exactly; 31 incoming paths total.
- All **2,965** root-delta paths preserved subject only to the two declared additive
  resolutions; missing newer files in old incoming trees are not deletions.
- **49** selected receipt paths checked: 47 unchanged root blobs, two explicit
  metadata resolutions. All seven frozen local owner hashes and blobs match.
- Root history00614/03f1, supporting Retry01771/512, latest769 and foundation H1/F2/F3
  ancestry survive. Newer personnel/sick-note/unlink, compiled PDF and #1745 UTC/offset
  work survive by full-root-tree preservation, not by importing old incoming trees.
- Six incoming production/five test paths only; all changed source, payload,
  canonical owner and capture-source Git pins are in the audit JSON.

No publisher52832 docs were imported/replayed. Candidate app content is root98 plus
this incoming change and the metadata reconciliation only. Parent must independently
compare its post-publication merge app tree and preservation against these pins.

## Public artifact provenance

Fresh read/hash/decode audit: **20 public files, 2,678,953 Git bytes**, comprising the
report, nine parsed JSON and ten fully decoded PNGs. All **18** declared artifact
hashes/sizes, **seven** owner hashes, **21 before** and **21 after** source pins match,
with explicit LF/CRLF tolerance for source materialization. Five restoration entries
bind the old base to c0dc; after captures/source pins bind phone4180. This is artifact
verification, not fresh execution of those older recorded tests or browser actions.

Retain the inherited evidence framing: original light16 desktop1600/wide2200/phone390
pairs are the five-consumer ab309 overlay on c0dc, with the new workspace unreferenced.
They are partial historical compositions, not a full historical build. Dark18 current
states and scrolled phone allowance view are separate. No current-only capture was
manufactured as a matched pair. Earlier sticky overlap, native audit failures, raw
failure/private-controller gaps and role/provider limitations remain. No private
images, logs, fixtures, credentials, auth state, worker dependency directories or
recursive private folder copies were inspected.

## Commands and qualifications

Literal successful merge commands:

```powershell
node .tmp/1740-isolated-merger-checks/prepare-merge.cjs
git merge --no-ff --no-commit 6473c5b41f387f9bfe1798b91be415c0f43dec02
git add -- apps/webapp/src/lib/navigation/route-metadata.ts apps/webapp/src/lib/navigation/route-metadata.test.ts
git write-tree
git -c core.hooksPath=NUL commit -m 'merge: review #1740 team absence calendar candidate'
```

The two resolved files were copied only from the independently prepared ignored
resolution files. Actual tree equality was asserted before commit.

Pinned package install, fresh and successful:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --version
pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy --verify-store-integrity
```

Version was **12.16.1** under normal approved engine access. Initial sandbox version
lookup warned it could not open the engine lock and printed 12.21.0; that fallback
was not used to install or test. Subsequent sandbox test launch also stopped at
the engine lock. Approved elevated invocations used the unchanged normal engine.
Own root/app/virtual-store directories are physical. Lock remains
`2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799`.
No fallback manager, manager-pin disablement, store/ACL/lock repair, dependency
borrowing, configuration overlay or upgrade was used.

Actual probe command on candidate and pinned premerge, run with the environment
setting above and normal engine access:

```powershell
pnpm --config.verify-deps-before-run=false -C apps/webapp exec vitest run --project unit src/test/1740-isolated-merger-bridge.test.tsx --reporter=verbose
```

The bridge was an exact owned untracked file generated from the safe probe with
only its user-event import relocated. Every update/removal checked its SHA256.
The premerge probe omitted the workspace-only test/import because that component
does not exist at root98. Same form test/real dependencies, no source overlay.
Git selections were ordinary `git switch --detach 98bc...` then
`git switch review/1740-team-absences`, only after clean tracked source and guarded
bridge removal. Exact physical owned `.vite` caches were checked and removed on
each side. No historical application source writes, migrations or servers.

Fresh static verification:

```powershell
node .tmp/1740-isolated-merger-checks/audit.cjs
git status --porcelain=v1
git log -1 --format='%H %P %T'
git rev-parse 'HEAD:apps/webapp'
Get-FileHash pnpm-lock.yaml
```

Initial preparation script hit Node's 1MB output buffer, then was corrected to a
bounded 32MB. The sandbox denied Git object writes; normal approved access created
only authorized own objects/index/feature commit. An initial audit treated the two
resolved metadata paths as unchanged owners and failed; it was corrected to label
exactly those two resolutions. Neither setup failure was product acceptance.

## Seal / own-only release

`resource-seal.json`: zero owned Node processes, zero Next servers started, zero
browser contexts started, zero fixture/services started, zero remaining bridges.
The CIM read was initially sandbox-denied; normal approved read-only access verified
zero matching own Node processes. No broad process/container cleanup was attempted.
Tracked checkout and index are clean on the candidate. Own dependencies and ignored
safe failed probes remain. `safe-allowlist.json` identifies retained own files by
size/SHA256; it is not a publication proof or authority to inspect anything else.

No root shared lease was acquired, changed or released. RELEASE OWN ONLY.
No root/peer file, dependency, runtime, credential, protected branch, tracker, PR,
ledger, README, report or proof publication mutation. No push, closure, dev merge,
deployment or final whole-branch code-review. Issues remain OPEN and any PR draft
state is untouched. Parent owns the small fix, renewed acceptance and eventual
post-publication candidate integration/readiness decision.

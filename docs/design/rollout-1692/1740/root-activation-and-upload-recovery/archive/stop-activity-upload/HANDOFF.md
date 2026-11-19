# #1740 independent activation recheck: STOP, current acceptance blocked

Candidate `e597efc34bc2bdc1fa5369496781fe6bb0105888` is restored clean on the
T3-prepared dedicated `test/recheck-root-fix` branch in
`X:/t3-code/worktrees/z8/t3-9ccb8bb8-a2dda608751b975d`.
Application tree `d664630c31a37e8e3ef015810e4842abd701e4e2` exactly matches root fix
`047e89193fbafa34ba7a9a3d3a1fee992ccd84bd`. No product fix, tracked source/config,
proof, report, ledger, tracker, push, PR, merge or readiness mutation was made.
`verifiedCommit` remains null. All issues remain OPEN.

## First confirmed blocker

**P1 acceptance blocker: a staged sick-note upload interrupted by Activity
hide/return cannot be retried from the retained recording form.**

Public reproduction on the exact current candidate, confirmed three times
(initial browser-build probe, minimized control, final cold-cache confirmation):

1. Open the actual RecordAbsenceDialog, select a sick category and Without
   certificate, choose a date in the real DatePicker, type Notes, and choose a
   synthetic PDF through the actual file input.
2. Click the actual Record absence submit button. Let the real Uppy/TUS uploader
   start its POST; hold that synthetic HTTP request pending. No command has run.
3. Commit React Activity hidden, then visible. The real dialog becomes inaccessible
   while hidden. On return, Notes and the selected PDF are retained.
4. Click the newly enabled Record absence button, a genuinely new activation.
5. Expected: a new upload request can begin, so this retained draft can recover.
   Actual: **one total HTTP request, zero recording commands, one error notification**.
   The error reads ` could not be uploaded. Remove it or try again.` The filename
   is blank. A replacement upload never begins.

The real staged hook keeps `activeRun` after its underlying uploader is destroyed.
`use-staged-sick-note-uploads.ts:123` rejects the next stage with
`StagedSickNoteUploadError("", "Upload in progress")`. Its staged-note wrapper
announces that error. The TUS effect cleanup at `use-tus-file-upload.ts:149-155`
removes callbacks and destroys Uppy without settling the retained staging run.
The record form's new lifetime resets its own pending state but not that run.
This explains the observed public failure; no hook or form store was replaced.
Parent owns any correction and its domain-owner coordination.

**Classification: inherited failed recovery still blocking current acceptance.**
The identical two-case contract ran after ordinary clean selection of the FULL
committed premerge `98bc0c4c82f32af17b0d6aee98fd7e42edc29a86` in this own checkout,
with an owned cold Vitest cache. Its positive upload control passed; Activity
recovery failed with one total request and zero commands. That version keeps the
submit disabled after return, rather than enabling it and displaying the new
error. The recovery failure is inherited; the exact current error presentation
is different. This is not evidence of a newly introduced upload regression.
The three shared upload source owners have identical Git blobs on both commits.

## Seam and controls

This is a deterministic public component ordering repro, not live browser
navigation. It uses real React 19.3.1 Activity, TanStack Form, ActionPanel, Select,
DatePicker, staged-note fields/hooks, Uppy/TUS, translations, QueryClient,
OrganizationContextProvider and ViewRefreshProvider. Only session, navigation,
server-action/fetch transport, and XMLHttpRequest HTTP transport are intercepted;
ResizeObserver/matchMedia are DOM shims. No internal hook/query state/form API,
validator, service factory or database mock is substituted. All input is synthetic.

The HTTP positive control completes the actual TUS POST and PATCH and observes
exactly one synthetic refusal command with the actual employee/category/detail/
Notes and staged upload key. It passes both current and premerge selections.
This proves the upload harness reaches real processing. The failing Activity
case never reaches the recording action. No server/domain mutation, authorization
bypass, upload storage write, cancellation guarantee or exactly-once persistence
claim follows from these transport observations.

Node's default test dependency resolution selected TUS's Node file reader, which
rejects browser File objects. That was a corrected setup failure, not a product
failure. The review-only `browser-upload.config.mts` imports the selected commit's
ordinary Vitest config and selects the exact installed `tus-js-client@4.3.1`
documented browser entry, with Uppy/TUS inlined for resolution. This is the real
shipped browser distribution, not an uploader implementation replacement or a
tracked configuration change. No external request is sent.

## Fresh results and stopping boundary

- Corrected old queued-submit regression: zero obsolete calls at click/hide/show
  and after validation; retained Notes; a genuinely new post-return submit sends
  one exact-target command and normal refusal feedback. Passed independently.
- `public-03.log`: **13 passes**, on one physical temporary bridge. Includes the
  queued regression above; do not add the earlier targeted run as another case.
  Other passes cover raw pending session with retained same-scope data; account
  and org A-B-A retirement/new action; actual list/calendar retained error states
  and local Retry; initial canonical-context failure/pending coalesced Retry/
  recovery; canonical employee/role change before queued dispatch; selected
  employee removal/return; late success/refusal/rejection after Activity with
  duplicate/pending-dismissal and new-command checks; assembled workspace
  calendar failure preserving the list and organization retirement.
- Minimal final candidate upload contract: **one positive control pass, one
  Activity recovery failure**, two identities through one temporary physical
  bridge. Same observations on two candidate runs and the earlier focused probe.
- Full pinned premerge control: **one positive pass, one recovery failure** for
  the same two identities. These overlap candidate coverage and are not summed.
- Behavioral union before STOP: 13 passing acceptance identities plus the one
  passing upload positive control and one failed upload-recovery contract.
  These are two retained source artifacts executed through one physical bridge
  path in separate runs. This is not the root 141/9 selection or a repository total.
- Root 141/9 unit, typegen/all three type projects, two-file lint/100-column CRLF
  and 12-file Doctor remain inherited reports, not freshly run here.
- STOP applies: no further broad acceptance, feature/staged-cleanup expansion,
  canonical PostgreSQL, migration verification, fixture, Next server, browser,
  native React/Next inspection, matched captures or runtime layout check ran.
  Phone/desktop/wide, theme/text-size/sidebar/reload/focus, live admin/manager/
  restricted-role/former/privacy/policy/partial-day/deputy readback, live scope
  revocation, provider, remote catalog, physical device/zoom and exhaustive race
  obligations remain OPEN. No production or compile-only build claim.
- Required React performance/composition/interface skills were read; the current
  interface guidelines were fetched. The review stopped at the behavioral
  blocker; no full accessibility/performance/architecture signoff is implied.

Setup failures retained privately and excluded from the safe allowlist:

- `public-01.log`: incorrect pending Retry-button locator; actual canonical
  recovery truthfully uses a loading status. Four product checks had passed.
- `public-02.log`: incorrect enabled-label locator during real pending submit;
  actual public button is Recording. Eight product checks had passed.
- `upload-01.log`: wrong accessible label, Sickness detail instead of Sick detail.
- `upload-02.log`: Node TUS file-reader resolution, before reaching HTTP.
- `upload-03.log`: review-only Vitest config import path failed before tests.
- Pinned engine lookup initially hit sandbox store-lock denial and printed a
  fallback 12.21.0. It was not used for install/tests. Normal approved execution
  used 12.16.1 with unchanged manager/lock/store policy. Initial CIM read was
  sandbox denied; approved read-only CIM later confirmed zero owned processes.
- A harmless React act warning appears in the passing read-Retry probe. It does
  not represent a product failure or prove runtime scheduling acceptance.

## Reproduction commands

Every pnpm invocation used the environment guard below and the CLI guard.
Exact pinned manager, physical offline/copy install:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --version
pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy --verify-store-integrity
```

Minimal current/premerge upload contract, with synthetic HTTP only:

```powershell
node .tmp/1740-activation-independent-checks/minimize.cjs
node .tmp/1740-activation-independent-checks/bridge.cjs write upload-recovery.test.tsx
pnpm --config.verify-deps-before-run=false -C apps/webapp exec vitest run --config ../../.tmp/1740-activation-independent-checks/browser-upload.config.mts --project unit src/test/1740-activation-independent-bridge.test.tsx --bail 1 --reporter=verbose
node .tmp/1740-activation-independent-checks/bridge.cjs remove
```

The premerge selection was `git switch --detach 98bc0c4c82f32af17b0d6aee98fd7e42edc29a86`,
followed by `git switch test/recheck-root-fix` only after hash-guarded bridge
removal and a clean status. Exact owned physical
`apps/webapp/node_modules/.vite` was validated under this checkout before deletion
for each cold comparison. No server existed, no source overlays, resets, force
operations, shell worktrees, peer dependencies or historical config rewrites.

Passing surrounding public run used ordinary config:

```powershell
pnpm --config.verify-deps-before-run=false -C apps/webapp exec vitest run --project unit src/test/1740-activation-independent-bridge.test.tsx --bail 1 --reporter=verbose
```

Its 13-case source predates addition of the focused upload probe.
`public-passing-13.test.tsx` is the reversible reconstruction of that executed
source by removing only the subsequently added upload case. Its hash was sealed
at handoff, not captured retrospectively as a contemporaneous run hash.

## Preservation, safe allowlist and own-only cleanup

`candidate-audit.json` pins the candidate/app/configs, seven protected owners,
actual source SHA256/Git blobs and premerge owner comparison. It confirms the
exact original candidate and clean tracked/index state after restoration.
Thus all original proof objects, including previously published archives,
61 anchors/baseline and route/alias metadata, are preserved; they were not
recounted or decoded afresh as acceptance. No earlier proof was rewritten.

Own root/app/virtual-store directories are physical. All **158** direct package
links (153 app, five root) resolve into this own checkout. Lock SHA256 remains
`2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799`.
No borrowed dependencies/config, ACL/store/version/lock workaround or fake
license artifact. No license was needed because acceptance stopped before types.

Only exact SHA256-guarded owned bridges and validated own caches were removed.
Own dependencies and ignored failed probes remain. `resource-seal.json` records
zero live owned processes and zero started Next/browser/fixture/container
resources; no cleanup touched any peer/root resource. No credentials, auth
cookies, token, session/localStorage export, browser profile, private failure
images or raw private action/RSC bodies were created, copied or inspected.

`safe-allowlist.json` lists only deliberately selected synthetic source, concise
result extracts, this handoff and integrity/resource metadata with sizes/hashes.
Raw failure logs, private auth/profile/controller/body/image paths are excluded.
`SHA256SUMS.txt` seals that allowlist. This is a local safe handoff, not published
evidence or permission to advance readiness. Root owns correction and re-review.

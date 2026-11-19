# #1740 independent upload recheck: STOP

P1 current acceptance blocker: a retained sick-note draft cannot replace its
pending upload after a failed employee-list read recovers. No product fix was made.

The exact clean candidate `e42b89a3d739541f884f90c5f9a6179ee2dd29e0` is restored on
`review/1740-upload-recovery-v2` in this T3-prepared checkout. Application tree
`add0d3054451325670d60f28c0ebdbe6e28bfada` matches upload source
`55b79c4720a689395e58c8b459a47e394656b6e0` exactly. No tracker, tracked report,
ledger, proof, readiness, root/peer/source worktree, push, PR, merge or deployment
mutation. #1740 remains provisional, verifiedCommit null, all issues OPEN. Latest
VERIFIED `e7089f663f6f7b388472794f211fcb6e49e7911f` remains unchanged for #1738/39.

## Minimal public reproduction

1. In the actual TeamAbsencesWorkspace, open Record absence for Review Person.
   Use the real Select and DatePicker to choose sick leave, Without certificate
   and a date. Type Notes and select the synthetic `review-note.pdf` file through
   the actual file input.
2. Click Record absence. Hold the real Uppy/browser-TUS POST pending at the
   synthetic XMLHttpRequest boundary. No recording command has run.
3. Deliver an employee-list error as the next public workspace result, then
   deliver a healthy same-scope list result. The workspace retains its list/form;
   the recording button is disabled during failure and enabled after recovery.
4. Notes and the PDF remain. Click Record absence again, a genuinely new
   activation after recovery.
5. Expected: a replacement upload can begin and complete through the exact
   recording command. Actual: **one total HTTP request, zero recording commands,
   one error notification**: ` could not be uploaded. Remove it or try again.`
   The message has a blank filename. A replacement upload never starts while the
   retired request remains pending. Cancelling/remounting would abandon the draft;
   the retained form's advertised retry does not recover it.

The final cold-cache run asserts those exact observations. Its steady positive
control completes a real TUS POST/PATCH and observes one synthetic refusal command
with the exact employee/category/sick-detail/Notes and uploaded key. Activity
hide/return replacement also completes successfully in the earlier two-case
upload controls. This is a distinct boundary from the Activity repair.

## Cause and classification

`team-absences-workspace.tsx:171` disables recording on a failed list read.
`team-absences-table.tsx:193` passes this as actionAvailable to the mounted form.
`record-absence-dialog.tsx:197-210` retires its command lifetime and clears pending
when availability changes, allowing a new submit after recovery. However,
`use-staged-sick-note-uploads.ts:73-91` clears its activeRun only on effect disposal.
This same-scope read failure does not dispose that hook or the Uppy instance.
The fresh submit reaches `use-staged-sick-note-uploads.ts:157-158`, which rejects
with `StagedSickNoteUploadError("", "Upload in progress")` instead of replacing
the old staging operation. The staged-section wrapper announces the blank-name
error. The old run may eventually settle; the repro does not claim otherwise.

**Inherited relative to the upload correction**, not a demonstrated regression
from `55b79c472`/`eb7c01b8`: the identical two-case assembled public contract was
run after clean selection of the FULL committed
`e597efc34bc2bdc1fa5369496781fe6bb0105888` in this own stopped checkout, with a
cold owned Vitest cache. Its positive control passes and its list-recovery case
fails at the same one-request-versus-two assertion. Current candidate confirmed
twice at the assembled seam, plus a direct-dialog public-prop probe. No comparison
to pre-#1740 legacy behavior was made, and no stronger inheritance claim is made.

## Public boundary and fresh results

All observations use actual React Activity, TanStack Form, ActionPanel, file fields,
staging/TUS hooks, Uppy, the shipped tus-js-client 4.3.1 browser distribution,
QueryClient, OrganizationContextProvider and ViewRefreshProvider. The assembled
minimal repro also uses the real workspace, table and year calendar. Only external
session/navigation/server-action/fetch/HTTP transports are intercepted; observer
and media-query APIs are DOM shims. Workspace RSC result arrivals are supplied
through its actual public props. No internal hook, query state, form API, validator,
service factory, database owner or uploader implementation is substituted.

Fresh results:

- Thirteen surrounding public controls pass, including queued Activity activation,
  retained pending session, account/org A-B-A, employee/role retirement, initial
  failed canonical context and coalesced Retry, independent retained list/calendar
  errors, and late success/refusal/rejection retirement with new post-return actions.
- Two actual browser-distribution TUS/synthetic HTTP controls pass: steady completion
  and interrupted Activity replacement through one exact refusal command.
- Direct availability-return probe fails. Minimized assembled steady control passes
  and list-error-return recovery fails, including the final cold-cache confirmation.
- The same assembled pair has one pass and one failure on pinned pre-correction
  e597efc34. Historical controls and repeated confirmations are not added to coverage.
- One unique physical bridge path executed four retained current source versions.
  Current results have 18 distinct fullname identities (16 pass, two fail) and
  20 assertion occurrences. The two failing names exercise the same blocker; the
  assembled steady control overlaps steady upload behavior. Behavioral union is
  13 surrounding passes plus normal/Activity upload passes plus one failed recovery
  contract. See results.json for every run, source hash and identity.

STOP applies. No broader late-processing/cleanup/cross-caller expansion, canonical
PostgreSQL/migration verification, fixture, Next/browser/native runtime, role/action
readback, preferences or captures ran. No new broad unit/type/lint/Doctor run.
Root 589 unit passes/73 passing files, three optional payslip browser skips in one
unchanged file, all three types/typegen, five-file explicitCRLF/lint and Doctor zero
remain inherited reports only. Earlier 61 PostgreSQL cases/four suites and captures
remain inherited. This synthetic component/HTTP evidence proves neither live bucket
storage/database persistence nor authorization bypass, atomic server cancellation
or exactly-once processing. Production generation, catalog/provider, broad roster,
physical device, true zoom and exhaustive authority/race acceptance remain OPEN.
Required performance/composition/interface guidance was read; this STOP is not a
full accessibility, design, architecture or performance signoff.

## Commands, dependencies and setup qualifications

Every pnpm invocation used BOTH environment and CLI guards. Approved execution used
the exact 12.16.1 engine. Install was ordinary physical offline frozen copy:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --version
pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy --verify-store-integrity
```

Minimal public contract (expected red on this candidate):

```powershell
node .tmp/1740-upload-independent-checks/minimize.cjs
node .tmp/1740-upload-independent-checks/bridge.cjs write workspace-recovery.test.tsx
pnpm --config.verify-deps-before-run=false -C apps/webapp exec vitest run --config ../../.tmp/1740-upload-independent-checks/browser-upload.config.mts --project unit src/test/1740-upload-independent-bridge.test.tsx --bail 1 --reporter=verbose
node .tmp/1740-upload-independent-checks/bridge.cjs remove
```

Original current and historical pair used retained workspace-recovery-v1.test.tsx;
the final version strengthens only the final observation assertion to include exact
commands and notification text. Both source versions are allowlisted. The broad
13 controls used public-surrounding.test.tsx with the ordinary tracked Vitest config.
The upload controls use upload-review.test.tsx with the private browser config.
Raw JSON/logs remain private. The safe results index records their digests, not bodies.

The private config resolves only the real installed browser TUS entry and imports
this checkout's unmodified tracked config. Vite's future native-loader warning is
unsuppressed. No tracked config rewrite, borrowed config/dependencies, dependency
version/store/ACL/lock workaround, fake license or external-provider call occurred.
Physical root/app/.pnpm directories and all 158 direct package links (153 app,
five root) are verified inside this own checkout. Lock SHA256 remains
`2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799`.

Setup failures are preserved and not treated as product failures: sandbox engine
store lock denial (the displayed fallback 12.21.0 was never used to install or test);
the first surrounding command ran zero tests for that denial, then the ordinary
same approved command passed; initial CIM denial resolved with the same read-only
approved query. Review-branch creation required normal common-Git-ref access.

## Restoration and safe seal

Candidate-audit.json verifies exact candidate/application/config/package/source pins,
clean tracked/index state and removal of the exact SHA256-guarded test bridge.
Full candidate restoration preserves all 61 anchors, baseline, 172 templates,
19 aliases and 445 published proof files by retaining the original Git tree; these
were not recounted or reverified as fresh product acceptance.

Resource-seal.json records **zero live owned runtimes** after a read-only CIM query
filtered to this exact checkout. No Next server, browser/profile, fixture, listener
or container was created. Only this own hash-guarded bridge and validated physical
Vitest cache were removed. Owned physical dependencies and private failed attempts
remain. No peer/root cleanup or global process/container sweep occurred.

safe-allowlist.json and SHA256SUMS.txt seal only synthetic source, concise result
metadata, pins, this handoff and resource information. Raw private logs/JSON,
auth/session/profile/controller/body inventories and failure images are excluded.
No credentials, saved/minted/copied/restored cookies/auth state or private action/RSC
bodies were created or inspected. Root owns any correction and a NEW re-review task.
